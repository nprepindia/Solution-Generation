import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { OpenAIEmbeddings } from '@langchain/openai';
import { AgentExecutor } from 'langchain/agents';
import { createToolCallingAgent } from 'langchain/agents';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { HumanMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { Pool, PoolClient } from 'pg';
import * as pgvector from 'pgvector/pg';
import { validate } from 'class-validator';
import { plainToClass } from 'class-transformer';
import { ServicableQuestion, SolutionOutputDto, ExtractedImage } from '../dto';
import { ImageProcessorService } from './image-processor.service';
import { LLMGenerationError } from '../../../common/exceptions';
import { NURSING_SYSTEM_PROMPT } from '../config/prompts.config';
import { GOOGLE_API_KEY } from '../config/service.config';

// Interface for vector search results
interface VectorSearchResult {
  id: string;
  content: string;
  metadata: {
    book?: string;
    book_title?: string;
    book_id?: string;
    chapter?: string;
    page_number?: number;
    page_start?: number;
    page_end?: number;
    paragraph_number?: number;
  };
  score: number;
}

// Interface for video search results
interface VideoSearchResult {
  video_id: string;
  time_start: string;
  time_end: string;
  score: number;
}

// Extended interface for questions with images
interface ServicableQuestionWithImages extends ServicableQuestion {
  images?: ExtractedImage[];
}

@Injectable()
export class SolutionGeneratorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SolutionGeneratorService.name);
  private readonly llm: ChatGoogleGenerativeAI;
  private readonly embeddings: OpenAIEmbeddings; // 3072 dimensions for books
  private readonly videoEmbeddings: OpenAIEmbeddings; // 1536 dimensions for videos
  private readonly pgPool: Pool;
  private agentExecutor: AgentExecutor;
  // Add embedding cache to prevent vector leakage in conversation history
  private embeddingCache: Map<string, number[]> = new Map();
  private embeddingCounter: number = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly imageProcessor: ImageProcessorService
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
      streaming: false, // Disable streaming to avoid stream errors
    });

    // Initialize OpenAI embeddings
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      throw new Error('OPENAI_API_KEY is required for embeddings');
    }

    // Initialize OpenAI embeddings for books (3072 dimensions)
    this.embeddings = new OpenAIEmbeddings({
      openAIApiKey: openaiApiKey,
      model: 'text-embedding-3-large',
      dimensions: 3072, // Explicit 3072 dimensions for books_2025
    });

    // Initialize OpenAI embeddings for videos (1536 dimensions)
    this.videoEmbeddings = new OpenAIEmbeddings({
      openAIApiKey: openaiApiKey,
      model: 'text-embedding-3-large',
      dimensions: 1536, // Reduced dimensions for video_recordings compatibility
    });

    // Initialize PostgreSQL pool with pgvector support
    const postgresVectorStoreUrl = this.configService.get<string>('POSTGRES_VECTOR_STORE_URL');
    if (!postgresVectorStoreUrl) {
      throw new Error('POSTGRES_VECTOR_STORE_URL is required');
    }

    this.pgPool = new Pool({
      connectionString: postgresVectorStoreUrl,
      ssl: {
        rejectUnauthorized: false // Accept self-signed certificates
      },
      max: 10, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
      connectionTimeoutMillis: 10000, // Return an error after 10 seconds if connection could not be established
      maxUses: 7500, // Close (and replace) a connection after it has been used 7500 times
    });

    // Register pgvector types for each new connection (following pgvector documentation)
    this.pgPool.on('connect', async (client) => {
      try {
        await pgvector.registerTypes(client);
        this.logger.log('pgvector types registered for new connection');
      } catch (error) {
        this.logger.error(`Failed to register pgvector types: ${error.message}`);
        throw error;
      }
    });

    this.logger.log('SolutionGeneratorService constructor completed, async initialization will happen in onModuleInit');
  }

  /**
   * NestJS lifecycle hook for async initialization
   */
  async onModuleInit(): Promise<void> {
    // Test the PostgreSQL connection with retry
    await this.testPgConnectionWithRetry();

    // Initialize agent with tools with retry
    await this.initializeAgentWithRetry();
    
    this.logger.log('SolutionGeneratorService initialized with PostgreSQL pgvector');
  }

  /**
   * Test PostgreSQL connection and pgvector extension with retry logic
   */
  private async testPgConnectionWithRetry(): Promise<void> {
    await this.retryOperation(
      async () => {
        const client = await this.pgPool.connect();
        
        try {
          // Register pgvector types for this test connection
          await pgvector.registerTypes(client);
          
          // Test basic connection
          const result = await client.query('SELECT NOW()');
          this.logger.log(`PostgreSQL connection successful: ${result.rows[0].now}`);
          
          // Test pgvector extension
          const vectorCheck = await client.query("SELECT * FROM pg_extension WHERE extname = 'vector'");
          if (vectorCheck.rows.length === 0) {
            throw new Error('pgvector extension not found in database');
          }
          this.logger.log(`pgvector extension found: version ${vectorCheck.rows[0].extversion}`);
          
          // Test that our functions exist
          const functionsCheck = await client.query(`
            SELECT proname FROM pg_proc 
            WHERE proname IN ('match_documents', 'match_video_recordings')
            AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
          `);
          
          if (functionsCheck.rows.length !== 2) {
            throw new Error('Required vector search functions (match_documents, match_video_recordings) not found');
          }
          
          this.logger.log('Required vector search functions found and pgvector types registered');
        } finally {
          client.release();
        }
      },
      'PostgreSQL Connection Test',
      5,
      2000
    );
  }

  /**
   * Initialize the LangChain agent with tools with retry logic
   */
  private async initializeAgentWithRetry(): Promise<void> {
    await this.retryOperation(
      async () => {
      const tools = [
        this.createGenerateEmbeddingTool(),
        this.createVectorSearchTool(),
          this.createVideoSearchTool(),
      ];

      const prompt = ChatPromptTemplate.fromMessages([
        ['system', `{systemMessage}{imagesContext}`],
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
        maxIterations: 15, // Increased further to handle slow DB operations
          verbose: true, // Enable verbose logging to debug tool execution
        returnIntermediateSteps: false,
        // Force tool usage by being stricter about errors
          handleParsingErrors: true, // Allow some error handling to prevent premature stopping
        });

        this.logger.log('LangChain agent initialized successfully with PostgreSQL pgvector and video search');
      },
      'LangChain Agent Initialization',
      3,
      1000
    );
  }

  /**
   * Create the generateEmbedding tool with dual dimension support
   */
  private createGenerateEmbeddingTool() {
    return tool(
      async ({ text }: { text: string }) => {
        return await this.retryOperation(
          async () => {
            this.logger.log(`Generating dual embeddings for: ${text.substring(0, 100)}...`);
            
            // Generate both embeddings simultaneously for compatibility with retry
            const [embedding3072, embedding1536] = await Promise.all([
              this.embeddings.embedQuery(text), // 3072 dimensions for books
              this.videoEmbeddings.embedQuery(text), // 1536 dimensions for videos
            ]);

            // Generate unique ID for this embedding pair
          const embeddingId = `emb_${++this.embeddingCounter}`;
          
            // Store both embeddings in cache with dimension suffixes
            this.embeddingCache.set(`${embeddingId}_3072`, embedding3072);
            this.embeddingCache.set(`${embeddingId}_1536`, embedding1536);

            this.logger.log(`Generated dual embeddings: ${embedding3072.length}D (books) and ${embedding1536.length}D (videos), cached as ${embeddingId}`);
            
            // Return only metadata, NOT the actual vectors (prevents token explosion)
          return { 
            embeddingId,
              dimensions: {
                books: embedding3072.length,
                videos: embedding1536.length
              },
              message: `Dual embeddings generated and cached as ${embeddingId}: ${embedding3072.length}D for books, ${embedding1536.length}D for videos`
            };
          },
          `Embedding Generation (${text.substring(0, 30)}...)`,
          5,
          2000
        );
      },
      {
        name: 'generateEmbedding',
        description: 'Generate embedding vectors for a text query to search through both nursing textbooks (3072D) and video lectures (1536D)',
        schema: z.object({
          text: z.string().describe('The text to generate embeddings for (usually the question or key concepts from the question)'),
        }),
      }
    );
  }

  /**
   * Create the vectorSearch tool for PostgreSQL using pgvector.toSql()
   */
  private createVectorSearchTool() {
    return tool(
      async ({ embeddingId, limit = 3 }: { embeddingId: string; limit?: number }) => {
    try {
          // Retrieve 3072D embedding from cache for books search
          const embedding = this.embeddingCache.get(`${embeddingId}_3072`);
          if (!embedding) {
            throw new Error(`3072D embedding not found in cache for ID: ${embeddingId}`);
  }

          // Cap the limit to prevent context explosion
          const cappedLimit = Math.min(limit, 4);
          this.logger.log(`Performing PostgreSQL vector search with ${embeddingId} (${embedding.length} dimensions), limit: ${cappedLimit}`);
          
          // Add small delay to prevent database overload
          await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay

          // Try vector search with retry and timeout handling
          let rows: any[] = [];
          
          rows = await this.retryOperation(
            async () => {
      const searchWithTimeout = async (searchFn: () => Promise<any>, timeoutMs: number = 20000) => {
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Vector search timeout')), timeoutMs);
        });
        
        return Promise.race([searchFn(), timeoutPromise]);
      };
      
              let client: PoolClient;
             try {
                // Get PostgreSQL client from pool (pgvector types already registered via pool.on('connect'))
                client = await this.pgPool.connect();
                
                // Use pgvector.toSql() for proper vector formatting (following documentation)
         const result = await searchWithTimeout(async () => {
                  return await client.query(`
                    SELECT * FROM match_documents($1, $2, $3)
                  `, [
                    pgvector.toSql(embedding), // Use pgvector.toSql() instead of manual formatting
                    cappedLimit,
                    '{}' // Empty filter JSON
                  ]);
         }, 20000);
        
                return result.rows || [];
        
             } catch (searchError) {
                this.logger.error(`PostgreSQL vector search failed: ${searchError.message}`);
                throw new Error(`Vector search unavailable: ${searchError.message}. Please check PostgreSQL connection and database status.`);
              } finally {
                if (client) {
                  client.release();
                }
              }
            },
            `Vector Search for ${embeddingId}`,
            5,
            2000
          );

          const results: VectorSearchResult[] = rows.map(row => ({
            id: row.id || 'unknown',
            content: row.content || '',
            metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
            score: row.score || 0,
          }));

          this.logger.log(`Found ${results.length} relevant documents using ${embeddingId} (pgvector.toSql formatted)`);

          // Format results for the agent with content truncation to prevent token explosion
      const formattedResults = results.map((result, index) => ({
        index: index + 1,
            content: this.truncateContent(result.content, 500), // Limit content to 500 chars
        source: {
              book: result.metadata.book_title || result.metadata.book || 'Unknown',
              chapter: result.metadata.chapter || `Page ${result.metadata.page_start || result.metadata.page_number || 0}`,
              page_number: result.metadata.page_start || result.metadata.page_number || 0,
              paragraph_number: result.metadata.paragraph_number || 1,
            },
            similarity: result.score,
          }));

          const toolResponse = `Found ${results.length} relevant textbook documents. **IMPORTANT: Use this source information for your "references" field in the JSON output.**

${results.map((result, index) => 
  `${index + 1}. [Score: ${result.score.toFixed(3)}]
  Book: "${result.metadata.book_title || result.metadata.book || 'Unknown'}" 
  Book ID: "${result.metadata.book_id || 'unknown'}"
  Pages: ${result.metadata.page_start || result.metadata.page_number || 0} - ${result.metadata.page_end || result.metadata.page_number || 0}
  
  **FULL CONTENT:**
  ${result.content}
  
  **Reference to include in JSON:** 
  {
    "book_title": "${result.metadata.book_title || result.metadata.book || 'Unknown'}",
    "book_id": "${result.metadata.book_id || 'unknown'}",
    "page_start": ${result.metadata.page_start || result.metadata.page_number || 0},
    "page_end": ${result.metadata.page_end || result.metadata.page_number || 0}
  }`
).join('\n\n')}

**CRITICAL: Include ALL these references in your JSON output "references" array using the exact format shown above.**`;

          return toolResponse;
    } catch (error) {
      this.logger.error(`Vector search failed: ${error.message}`);
          throw new Error(`Vector search tool failed: ${error.message}. Please check PostgreSQL connection and database status.`);
    }
      },
      {
        name: 'vectorSearch',
        description: 'Search through the nursing textbook database using a cached embedding ID to find relevant context',
        schema: z.object({
          embeddingId: z.string().describe('The embedding ID returned from generateEmbedding tool'),
          limit: z.number().optional().describe('Maximum number of results to return (default: 4)'),
        }),
      }
    );
  }

  /**
   * Create video search tool for searching video recordings
   */
  private createVideoSearchTool() {
    return tool(
      async ({ embeddingId, limit = 4 }: { embeddingId: string; limit?: number }) => {
        try {
          // Add 500ms delay to prevent database overload
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Get the 1536D embedding from cache for video search
          const cacheKey = `${embeddingId}_1536`;
          const embedding = this.embeddingCache.get(cacheKey);
          
          if (!embedding) {
            throw new Error(`Embedding ${embeddingId} not found in cache. Please use generateEmbedding first.`);
          }

          this.logger.log(`Performing PostgreSQL video search with ${embeddingId} (1536 dimensions - halfvec compatible), limit: ${limit}`);

          // Use retryOperation wrapper for video search (same as vector search)
          const videos = await this.retryOperation(
            async () => {
              const searchWithTimeout = async (searchFn: () => Promise<any>, timeoutMs: number = 20000) => {
                return Promise.race([
                  searchFn(),
                  new Promise((_, reject) => 
                    setTimeout(() => reject(new Error(`Video search timeout after ${timeoutMs}ms`)), timeoutMs)
                  )
                ]);
              };

              let client: PoolClient;
              try {
                client = await this.pgPool.connect();
                
                // Use pgvector.toSql() for proper PostgreSQL vector formatting
                const embeddingStr = pgvector.toSql(embedding);
                
                // Updated query to select ALL fields to provide full context to LLM
                const result = await searchWithTimeout(async () => {
                  return client.query(`
                    SELECT *,
                      1 - (embedding_half <=> $1::halfvec) AS score
                    FROM video_recordings
                    WHERE embedding_half IS NOT NULL
                    ORDER BY embedding_half <=> $1::halfvec
                    LIMIT $2
                  `, [embeddingStr, limit]);
                });

                return result.rows.map(row => ({
                  video_id: row.video_id,
                  time_start: row.time_start,
                  time_end: row.time_end,
                  content: row.content || row.transcript || '', // Include content/transcript
                  score: row.score,
                  metadata: row.metadata || {},
                }));

              } catch (searchError) {
                this.logger.error(`PostgreSQL video search failed: ${searchError.message}`);
                throw new Error(`Video search unavailable: ${searchError.message}. Please check PostgreSQL connection and database status.`);
              } finally {
                if (client) {
                  client.release();
                }
              }
            },
            `Video Search for ${embeddingId}`,
            5,
            2000
          );

          this.logger.log(`Found ${videos.length} relevant videos using ${embeddingId} (halfvec compatible)`);

          if (videos.length === 0) {
            return 'No relevant videos found. The video database may be empty or the search terms may be too specific.';
          }

          const videoToolResponse = `Found ${videos.length} relevant video content. **IMPORTANT: Use this video information for your "video_references" field in the JSON output.**

${videos.map((video, index) => 
  `${index + 1}. [Score: ${video.score.toFixed(3)}]
  Video ID: ${video.video_id}
  Time Range: ${video.time_start} - ${video.time_end}
  
  **FULL VIDEO CONTENT/TRANSCRIPT:**
  ${video.content}
  
  **Video Reference to include in JSON:**
  {
    "video_id": "${video.video_id}",
    "time_start": "${video.time_start}",
    "time_end": "${video.time_end}"
  }`
).join('\n\n')}

**CRITICAL: Include ALL these video references in your JSON output "video_references" array. This is required for proper video citation.**`;

          return videoToolResponse;

        } catch (error) {
          this.logger.error(`Video search failed after all retries: ${error.message}`);
          return `Video search unavailable: ${error.message}. Please check PostgreSQL connection and database status.`;
        }
      },
      {
        name: 'videoSearch',
        description: 'Search for relevant video content using halfvec embeddings. Use when you need video references or visual demonstrations.',
        schema: z.object({
          embeddingId: z.string().describe('Embedding ID from generateEmbedding tool (format: emb_N)'),
          limit: z.number().optional().describe('Number of videos to retrieve (1-5, default: 4)'),
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

  /**
   * Truncate content to prevent token explosion
   */
  private truncateContent(content: string, maxLength: number): string {
    if (!content || content.length <= maxLength) {
      return content;
    }
    return content.substring(0, maxLength) + '...';
  }

  /**
   * Clear embedding cache to prevent memory leaks between questions
   */
  private clearEmbeddingCache(): void {
    this.embeddingCache.clear();
    this.embeddingCounter = 0;
    this.logger.log('Embedding cache cleared');
  }

  /**
   * Retry wrapper for operations with exponential backoff
   */
  private async retryOperation<T>(
    operation: () => Promise<T>,
    operationName: string,
    maxRetries: number = 5,
    baseDelay: number = 2000
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.log(`${operationName} - Attempt ${attempt}/${maxRetries}`);
        const result = await operation();
        
        if (attempt > 1) {
          this.logger.log(`✅ ${operationName} succeeded on attempt ${attempt}`);
        }
        return result;
      } catch (error) {
        lastError = error as Error;
        const errorMessage = error.message || 'Unknown error';
        
        this.logger.error(`❌ ${operationName} failed on attempt ${attempt}/${maxRetries}: ${errorMessage}`);
        
        if (attempt === maxRetries) {
          this.logger.error(`🚫 ${operationName} failed after ${maxRetries} attempts`);
          break;
        }
        
        // Enhanced exponential backoff with jitter: 2s, 4s, 8s, 16s, 32s (with 30% jitter)
        const jitter = Math.random() * 0.3; // 0-30% jitter
        const delay = Math.floor(baseDelay * Math.pow(2, attempt - 1) * (1 + jitter));
        this.logger.log(`⏳ Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError;
  }

  /**
   * Cleanup method to close PostgreSQL pool connections
   */
  async onModuleDestroy(): Promise<void> {
    try {
      await this.pgPool.end();
      this.logger.log('PostgreSQL pool connections closed');
    } catch (error) {
      this.logger.error(`Error closing PostgreSQL pool: ${error.message}`);
    }
  }

  /**
   * Create multimodal input for LangChain agent with text and images
   */
  private createMultimodalInput(textMessage: string, images: ExtractedImage[]): any {
    // Build content array for multimodal input
    const contentParts: any[] = [];
    
    this.logger.log(`🔍 DEBUG - Creating multimodal input with ${images.length} images`);
    
    // Add the text content first
    contentParts.push({
      type: "text",
      text: textMessage
    });
    
    this.logger.log(`🔍 DEBUG - Added text content: ${textMessage.substring(0, 100)}...`);
    
    // Add images using LangChain format for Google Gemini
    for (const [index, image] of images.entries()) {
      const imageContent = {
        type: "image_url",
        image_url: {
          url: `data:${image.mimeType};base64,${image.data}`
        }
      };
      
      contentParts.push(imageContent);
      
      this.logger.log(`🔍 DEBUG - Added image ${index}: MIME=${image.mimeType}, data length=${image.data.length}, URL preview=data:${image.mimeType};base64,${image.data.substring(0, 50)}...`);
    }

    this.logger.log(`🔍 DEBUG - Final multimodal input has ${contentParts.length} content parts (1 text + ${images.length} images)`);

    return contentParts;
  }

  /**
   * Public interface for generating solutions with custom system message and optional images
   * @param question - The question data containing question text, options, and optional images
   * @param systemMessage - Custom system message for the LLM
   * @returns Promise<SolutionOutputDto> - Solution with answer, description, references, and images
   */
  async generate(question: ServicableQuestionWithImages, systemMessage: string): Promise<SolutionOutputDto> {
    try {
      // Clear embedding cache for each new question to prevent memory leaks and token accumulation
      this.clearEmbeddingCache();
      
      this.logger.log(`Generating solution for question: ${question.question.substring(0, 100)}...`);
      
      // DEBUG: Log the original question and options
      this.logger.log(`🔍 DEBUG - Original question: ${question.question}`);
      this.logger.log(`🔍 DEBUG - Original options: ${JSON.stringify(question.options, null, 2)}`);
      
      // Process question and options for embedded images (markdown format)
      let processedQuestion = question.question;
      let processedOptions = question.options;
      let extractedImages: ExtractedImage[] = question.images || [];

      // Check if question or options contain markdown images
      const hasMarkdownImages = [question.question, ...question.options].some(text => 
        text.includes('![') && text.includes('](')
      );

      this.logger.log(`🔍 DEBUG - Has markdown images detected: ${hasMarkdownImages}`);

      if (hasMarkdownImages) {
        this.logger.log('🖼️ Detected markdown images in question/options - processing...');
        
        // DEBUG: Log each text being checked
        this.logger.log(`🔍 DEBUG - Checking question for images: ${question.question.includes('![') && question.question.includes('](')} - "${question.question}"`);
        question.options.forEach((option, index) => {
          const hasImage = option.includes('![') && option.includes('](');
          this.logger.log(`🔍 DEBUG - Option ${index} has image: ${hasImage} - "${option}"`);
        });
        
        // Extract and process images from markdown
        const imageResult = await this.imageProcessor.processQuestionAndOptions(
          question.question,
          question.options
        );
        
        processedQuestion = imageResult.question;
        processedOptions = imageResult.options;
        
        // DEBUG: Log processed results
        this.logger.log(`🔍 DEBUG - Processed question: ${processedQuestion}`);
        this.logger.log(`🔍 DEBUG - Processed options: ${JSON.stringify(processedOptions, null, 2)}`);
        this.logger.log(`🔍 DEBUG - Extracted images count: ${imageResult.images.length}`);
        
        // Log image details
        imageResult.images.forEach((img, index) => {
          this.logger.log(`🔍 DEBUG - Image ${index}: MIME=${img.mimeType}, URL=${img.originalUrl}, Data length=${img.data.length}, Alt="${img.altText}"`);
        });
        
        // Combine extracted images with any existing images
        extractedImages = [...extractedImages, ...imageResult.images];
        
        this.logger.log(`🖼️ Processed markdown images: found ${imageResult.images.length} images, total: ${extractedImages.length}`);
      }

      // DEBUG: Final image check
      this.logger.log(`🔍 DEBUG - Final extracted images count: ${extractedImages.length}`);
      
      // Build the text message for the agent using processed text
      const textMessage = `Question: ${processedQuestion}
Options:
${processedOptions[0]}
${processedOptions[1]}
${processedOptions[2]}
${processedOptions[3]}`;

      this.logger.log(`🔍 DEBUG - Final text message for AI: ${textMessage}`);

      // Use LangChain agent for ALL questions with text-only input
      // Images are handled conceptually through text context, not multimodal input
      let result;
      
      if (extractedImages && extractedImages.length > 0) {
        this.logger.log(`🖼️ Question includes ${extractedImages.length} images - using agent with image context information`);
        
        // Build images context for the prompt (descriptive text, not actual images)
        const imagesContext = `\n\nIMAGES PROVIDED: This question includes ${extractedImages.length} image(s). The question may contain visual elements that need to be considered when determining the answer. Use the text content and context clues to understand what the images might show and factor this into your analysis.`;
        
        // Use text-only input but include image context
        this.logger.log('🚀 Starting LangChain agent execution with text input and image context...');
        result = await this.executeWithTimeout(
          this.agentExecutor.invoke({
            input: textMessage, // Always text-only for agent compatibility
            systemMessage: systemMessage,
            imagesContext: imagesContext,
          }),
          120000 // 120 second timeout - increased for DB operations
        );
      } else {
        this.logger.log('📝 Text-only question - using agent with tools for reference lookup');
        
        this.logger.log('🚀 Starting LangChain agent execution with text input...');
        result = await this.executeWithTimeout(
          this.agentExecutor.invoke({
            input: textMessage,
            systemMessage: systemMessage,
            imagesContext: '', // Empty for text-only questions
          }),
          120000 // 120 second timeout - increased for DB operations
        );
      }

      this.logger.log('✅ LangChain agent execution completed successfully');

      // Handle empty output from various issues
      if (!result.output || (Array.isArray(result.output) && result.output.length === 0) || result.output.trim() === '') {
        this.logger.warn('Empty output detected. Agent result:', JSON.stringify(result, null, 2));
        this.logger.warn('This could be due to: token limit, iteration limit, tool failures, or prompt issues.');
        throw new LLMGenerationError('Agent returned empty output. This could be due to token limit exhaustion, iteration limit reached, database timeouts, or tool execution failures. Check verbose logs for details.');
      }

      // Extract and parse the JSON response directly (prompt now specifies exact format)
      const responseText = result.output;
      let parsedResponse;

      this.logger.log(`🔍 DEBUG - Raw agent response: ${responseText}`);

      try {
        // Try to extract JSON from the response text
        let jsonString = responseText.trim();
        
        // Look for JSON object boundaries
        const jsonStart = jsonString.indexOf('{');
        const jsonEnd = jsonString.lastIndexOf('}');
        
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
          jsonString = jsonString.substring(jsonStart, jsonEnd + 1);
        }
        
        this.logger.log(`🔍 DEBUG - Extracted JSON string: ${jsonString}`);
        
        parsedResponse = JSON.parse(jsonString);
        this.logger.log(`🔍 DEBUG - Parsed response object: ${JSON.stringify(parsedResponse, null, 2)}`);
      } catch (parseError) {
        this.logger.error('Failed to parse agent response as JSON:', responseText);
        throw new LLMGenerationError(`Invalid JSON response from LangChain agent: ${parseError.message}`);
      }

      // Validate the result
      const validatedResult = await this.validateAndTransformResponse(parsedResponse);
      
      this.logger.log('Solution generated successfully');
      return validatedResult;
    } catch (error) {
      this.logger.error(`Failed to generate solution: ${error.message}`, error.stack);
      throw new LLMGenerationError(`Failed to generate solution: ${error.message}`);
    }
  }

  /**
   * Legacy method for backward compatibility
   * @param question - The question data containing question text and options
   * @returns Promise<SolutionOutputDto> - Solution with answer, description, references, and images
   */
  async generateSolution(question: ServicableQuestion): Promise<SolutionOutputDto> {
    return this.generate(question, NURSING_SYSTEM_PROMPT);
  }

  /**
   * Validate and transform the LLM response
   */
  private async validateAndTransformResponse(response: any): Promise<SolutionOutputDto> {
    try {
      this.logger.log(`🔍 DEBUG - Starting validation for response: ${JSON.stringify(response, null, 2)}`);
      
      // Transform plain object to DTO class
      const dto = plainToClass(SolutionOutputDto, response);
      
      this.logger.log(`🔍 DEBUG - Transformed to DTO: ${JSON.stringify(dto, null, 2)}`);
      
      // Validate the DTO
      const errors = await validate(dto);
      if (errors.length > 0) {
        this.logger.error(`🔍 DEBUG - Validation errors found: ${errors.length}`);
        errors.forEach((error, index) => {
          this.logger.error(`🔍 DEBUG - Error ${index}: Property '${error.property}', Value: ${JSON.stringify(error.value)}`);
          this.logger.error(`🔍 DEBUG - Constraints: ${JSON.stringify(error.constraints)}`);
        });
        
        const errorMessages = errors.map(error => 
          `Property '${error.property}': ${Object.values(error.constraints || {}).join(', ')}`
        ).join('; ');
        throw new Error(`Validation failed: ${errorMessages}`);
      }

      // Additional business logic validation
      if (dto.answer < 0 || dto.answer > 3) {
        throw new Error('Answer must be between 0 and 3 (0-based index for options A-D)');
      }

      if (!dto.ans_description || dto.ans_description.trim().length === 0) {
        throw new Error('Answer description cannot be empty');
      }

      this.logger.log('✅ Response validation successful');
      return dto;
    } catch (error) {
      this.logger.error(`❌ Response validation failed: ${error.message}`);
      throw new LLMGenerationError(`Invalid response format: ${error.message}`);
    }
  }
} 