import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { AgentExecutor } from 'langchain/agents';
import { createToolCallingAgent } from 'langchain/agents';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { HumanMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { firstValueFrom } from 'rxjs';
import { validate } from 'class-validator';
import { plainToClass } from 'class-transformer';
import { ServicableQuestion, ClassificationOutputDto, ExtractedImage } from '../dto';
import { ApiRequestError } from '../../../common/exceptions/api-request.exception';
import { LLMGenerationError } from '../../../common/exceptions';
import { QUESTION_TAGGING_PROMPT } from '../config/prompts.config';
import { GOOGLE_API_KEY } from '../config/service.config';

export interface SubjectResponse {
  id: number;
  name: string;
}

export interface TopicResponse {
  id: number;
  name: string;
}

export interface CategoryResponse {
  id: number;
  name: string;
}

// Extended interface for questions with images
interface ServicableQuestionWithImages extends ServicableQuestion {
  images?: ExtractedImage[];
}

@Injectable()
export class QuestionTaggerService {
  private readonly logger = new Logger(QuestionTaggerService.name);
  private readonly baseUrl = 'https://api.nprep.in/v3/admin';
  private readonly llm: ChatGoogleGenerativeAI;
  private agentExecutor: AgentExecutor;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    // Initialize Gemini AI with LangChain
    if (!GOOGLE_API_KEY) {
      throw new Error('GOOGLE_API_KEY is required');
    }

        this.llm = new ChatGoogleGenerativeAI({
      apiKey: GOOGLE_API_KEY,
      model: 'gemini-2.5-pro-preview-06-05', // Use stable model instead of preview
      temperature: 0,
      maxOutputTokens: 4096, // Reduced to leave more room for input context
      maxRetries: 3,
    });

    // Initialize agent with tools
    this.initializeAgent();

    this.logger.log('QuestionTaggerService initialized with LangChain');
  }

  /**
   * Initialize the LangChain agent with classification tools
   */
  private async initializeAgent(): Promise<void> {
    try {
      const tools = [
        this.createChooseSubjectTool(),
        this.createChooseTopicTool(),
        this.createChooseCategoryTool(),
      ];

      const prompt = ChatPromptTemplate.fromMessages([
        ['system', `${QUESTION_TAGGING_PROMPT}

IMPORTANT: After using the classification tools to find the appropriate IDs, you MUST respond with a valid JSON object in this exact format:
{{
  "subject_id": <number>,
  "topic_id": <number>,
  "category_id": <number or 0 if no categories found>
}}`],
        ['human', '{input}'],
        ['placeholder', '{agent_scratchpad}'],
      ]);

      const agent = await createToolCallingAgent({
        llm: this.llm,
        tools,
        prompt,
      });

      this.agentExecutor = new AgentExecutor({
        agent,
        tools,
        maxIterations: 8, // Reduced to prevent context explosion
        verbose: true,
        returnIntermediateSteps: false,
        // Add early stopping to prevent infinite loops
        handleParsingErrors: true,
        earlyStoppingMethod: 'force',
      });

      this.logger.log('LangChain classification agent initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize LangChain agent:', error);
      throw error;
    }
  }

  /**
   * Create the chooseSubject tool
   */
  private createChooseSubjectTool() {
    return tool(
      async () => {
        try {
          this.logger.log('Fetching subjects for classification...');
          const subjects = await this.getSubjects();
          
          this.logger.log(`Found ${subjects.length} available subjects`);
          return {
            subjects: subjects,
            count: subjects.length,
            message: `Found ${subjects.length} available subjects. Please choose the most appropriate subject_id.`
          };
        } catch (error) {
          this.logger.error(`Failed to fetch subjects: ${error.message}`);
          throw error;
        }
      },
      {
        name: 'chooseSubject',
        description: 'Get a list of all available subjects to choose from for question classification',
        schema: z.object({}),
      }
    );
  }

  /**
   * Create the chooseTopic tool
   */
  private createChooseTopicTool() {
    return tool(
      async ({ subject_id }: { subject_id: number }) => {
        try {
          this.logger.log(`Fetching topics for subject ID: ${subject_id}`);
          
          const topics = await this.getTopics(subject_id);
          
          this.logger.log(`Found ${topics.length} topics for subject ${subject_id}`);
          return {
            topics: topics,
            count: topics.length,
            subject_id: subject_id,
            message: `Found ${topics.length} topics for subject ${subject_id}. Please choose the most appropriate topic_id.`
          };
        } catch (error) {
          this.logger.error(`Failed to fetch topics: ${error.message}`);
          throw error;
        }
      },
      {
        name: 'chooseTopic',
        description: 'Get a list of topics available for a specific subject to choose from',
        schema: z.object({
          subject_id: z.number().describe('The ID of the subject to get topics for'),
        }),
      }
    );
  }

  /**
   * Create the chooseCategory tool
   */
  private createChooseCategoryTool() {
    return tool(
      async ({ topic_id }: { topic_id: number }) => {
        try {
          this.logger.log(`Fetching categories for topic ID: ${topic_id}`);
          
          const categories = await this.getCategories(topic_id);
          
          this.logger.log(`Found ${categories.length} categories for topic ${topic_id}`);
          return {
            categories: categories,
            count: categories.length,
            topic_id: topic_id,
            message: categories.length > 0 
              ? `Found ${categories.length} categories for topic ${topic_id}. Please choose the most appropriate category_id.`
              : `No categories found for topic ${topic_id}. Use category_id as 0.`
          };
        } catch (error) {
          this.logger.error(`Failed to fetch categories: ${error.message}`);
          throw error;
        }
      },
      {
        name: 'chooseCategory',
        description: 'Get a list of categories available for a specific topic to choose from',
        schema: z.object({
          topic_id: z.number().describe('The ID of the topic to get categories for'),
        }),
      }
    );
  }

  /**
   * Timeout wrapper for LangChain agent execution to prevent hanging
   */
  private async executeWithTimeout<T>(promise: Promise<T>, timeoutMs: number = 60000): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`LangChain execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]);
  }

  // Removed classifyWithImages method - use agent with tools for ALL questions

  /**
   * Classifies a question by assigning subject, topic, and category IDs
   * @param question - The question data containing question text, options, and optional images
   * @param solution - Optional solution description for better classification context
   * @returns Promise<ClassificationOutputDto> - Classification with subject_id, topic_id, and category_id
   */
  async classifyQuestion(question: ServicableQuestionWithImages, solution?: string): Promise<ClassificationOutputDto> {
    try {
      this.logger.log(`Classifying question: ${question.question.substring(0, 100)}...`);
      
      // Format user message as specified
      let textMessage = `Question:
${question.question}

Options:
${question.options[0]}
${question.options[1]}
${question.options[2]}
${question.options[3]}`;

      // Add solution if provided
      if (solution) {
        textMessage += `\n\nSolution:
${solution}`;
      }

      // Build multimodal input for the agent if images are present
      let agentInput;
      if (question.images && question.images.length > 0) {
        this.logger.log(`Processing question with ${question.images.length} images using agent with tools`);
        
        // Build content array for multimodal input following LangChain format
        const contentParts: any[] = [];
        
        // Add the question text first
        contentParts.push({
          type: "text",
          text: textMessage
        });
        
        // Add images using correct LangChain format for Google Gemini
        for (const image of question.images) {
          contentParts.push({
            type: "image_url",
            image_url: {
              url: `data:${image.mimeType};base64,${image.data}`
            }
          });
        }
        
        agentInput = {
          input: new HumanMessage({
            content: contentParts
          })
        };
      } else {
        this.logger.log('Processing text-only question using agent with tools');
        agentInput = {
          input: textMessage
        };
      }

      // Use agent with tools for ALL questions (text-only AND multimodal)
      const result = await this.executeWithTimeout(
        this.agentExecutor.invoke(agentInput),
        60000 // 60 second timeout
      );

      // Extract and parse the JSON response
      const responseText = result.output;
      let parsedResponse;

      try {
        // Try to extract JSON from the response text
        let jsonString = responseText.trim();
        
        // Look for JSON object boundaries
        const jsonStart = jsonString.indexOf('{');
        const jsonEnd = jsonString.lastIndexOf('}');
        
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
          jsonString = jsonString.substring(jsonStart, jsonEnd + 1);
        }
        
        parsedResponse = JSON.parse(jsonString);
      } catch (parseError) {
        this.logger.error('Failed to parse agent response as JSON:', responseText);
        throw new LLMGenerationError(`Invalid JSON response from LangChain agent: ${parseError.message}`);
      }

      // Validate the result
      const validatedResult = await this.validateAndTransformResponse(parsedResponse);
      
      this.logger.log('Question classification completed successfully');
      return validatedResult;
    } catch (error) {
      this.logger.error(`Failed to classify question: ${error.message}`, error.stack);
      throw new LLMGenerationError(`Failed to classify question: ${error.message}`);
    }
  }

  /**
   * Validate and transform the LLM response
   */
  private async validateAndTransformResponse(response: any): Promise<ClassificationOutputDto> {
    try {
      this.logger.log('Starting validation and transformation of LLM response');
      
      // Ensure response is an object
      if (!response || typeof response !== 'object') {
        throw new Error('Response must be a valid object');
      }

      // Apply transformation logic: convert 0 values to null
      const transformedResponse = {
        subject_id: response.subject_id,
        topic_id: response.topic_id === 0 ? null : response.topic_id,
        category_id: response.category_id === 0 ? null : response.category_id,
      };

      this.logger.debug('Applied transformation logic', {
        original: response,
        transformed: transformedResponse
      });

      // Transform plain object to DTO class
      const dto = plainToClass(ClassificationOutputDto, transformedResponse);
      
      // Validate the DTO using class-validator
      const errors = await validate(dto);
      if (errors.length > 0) {
        const errorMessages = errors.map(error => 
          Object.values(error.constraints || {}).join(', ')
        ).join('; ');
        throw new Error(`Validation failed: ${errorMessages}`);
      }

      // Additional business logic validation
      if (!dto.subject_id || dto.subject_id <= 0) {
        throw new Error('Subject ID must be a positive integer');
      }

      // topic_id and category_id can be null (when 0 is transformed to null)
      // but if they have values, they must be positive integers
      if (dto.topic_id !== null && dto.topic_id <= 0) {
        throw new Error('Topic ID must be null or a positive integer');
      }

      if (dto.category_id !== null && dto.category_id <= 0) {
        throw new Error('Category ID must be null or a positive integer');
      }

      this.logger.log('Classification response validation and transformation successful', {
        subject_id: dto.subject_id,
        topic_id: dto.topic_id,
        category_id: dto.category_id
      });
      
      return dto;
    } catch (error) {
      this.logger.error(`Response validation failed: ${error.message}`);
      throw new LLMGenerationError(`Invalid classification response format: ${error.message}`);
    }
  }



  /**
   * Fetches all subjects from the API
   * @returns Promise<SubjectResponse[]> - List of subjects with id and name
   */
  private async getSubjects(): Promise<SubjectResponse[]> {
    try {
      const token = this.configService.get<string>('NPREP_API_BEARER_TOKEN');
      if (!token) {
        throw new ApiRequestError('NPREP API Bearer token not configured');
      }

      const response = await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/subject`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          params: {
            fields: 'id,name',
          },
        }),
      );

      if (response.status !== 200) {
        throw new ApiRequestError(
          `Failed to fetch subjects: HTTP ${response.status}`,
          response.status,
        );
      }

      this.logger.debug(`Fetched ${response.data?.length || 0} subjects`);
      return response.data;
    } catch (error) {
      if (error instanceof ApiRequestError) {
        throw error;
      }
      this.logger.error('Error fetching subjects:', error.message);
      throw new ApiRequestError(
        'Failed to fetch subjects from API',
        error.response?.status,
        error,
      );
    }
  }

  /**
   * Fetches topics for a given subject ID
   * @param subjectId - The subject ID to fetch topics for
   * @returns Promise<TopicResponse[]> - List of topics with id and name
   */
  private async getTopics(subjectId: number): Promise<TopicResponse[]> {
    try {
      const token = this.configService.get<string>('NPREP_API_BEARER_TOKEN');
      if (!token) {
        throw new ApiRequestError('NPREP API Bearer token not configured');
      }

      const response = await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/topic`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          params: {
            filters: `subject_id||$eq||${subjectId}`,
            fields: 'id,name',
          },
        }),
      );

      if (response.status !== 200) {
        throw new ApiRequestError(
          `Failed to fetch topics for subject ${subjectId}: HTTP ${response.status}`,
          response.status,
        );
      }

      this.logger.debug(`Fetched ${response.data?.length || 0} topics for subject ${subjectId}`);
      return response.data;
    } catch (error) {
      if (error instanceof ApiRequestError) {
        throw error;
      }
      this.logger.error(`Error fetching topics for subject ${subjectId}:`, error.message);
      throw new ApiRequestError(
        `Failed to fetch topics for subject ${subjectId} from API`,
        error.response?.status,
        error,
      );
    }
  }

  /**
   * Fetches categories for a given topic ID
   * @param topicId - The topic ID to fetch categories for
   * @returns Promise<CategoryResponse[]> - List of categories with id and name
   */
  private async getCategories(topicId: number): Promise<CategoryResponse[]> {
    try {
      const token = this.configService.get<string>('NPREP_API_BEARER_TOKEN');
      if (!token) {
        throw new ApiRequestError('NPREP API Bearer token not configured');
      }

      const response = await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/question-category`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          params: {
            filters: `topic_id||$eq||${topicId}`,
            fields: 'id,name',
          },
        }),
      );

      if (response.status !== 200) {
        throw new ApiRequestError(
          `Failed to fetch categories for topic ${topicId}: HTTP ${response.status}`,
          response.status,
        );
      }

      this.logger.debug(`Fetched ${response.data?.length || 0} categories for topic ${topicId}`);
      return response.data;
    } catch (error) {
      if (error instanceof ApiRequestError) {
        throw error;
      }
      this.logger.error(`Error fetching categories for topic ${topicId}:`, error.message);
      throw new ApiRequestError(
        `Failed to fetch categories for topic ${topicId} from API`,
        error.response?.status,
        error,
      );
    }
  }
} 