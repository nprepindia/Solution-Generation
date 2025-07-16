import { Controller, Post, Body, Logger, HttpStatus, HttpException } from '@nestjs/common';
import { SolutionGeneratorService } from './solution-generation/services/solution-generator.service';
import { DifficultyGraderService } from './solution-generation/services/difficulty-grader.service';
import { QuestionTaggerService } from './solution-generation/services/question-tagger.service';
import { ImageProcessorService } from './solution-generation/services/image-processor.service';
import { ServicableQuestion, Solution } from './solution-generation/dto';

@Controller('solution-generation')
export class SolutionGenerationController {
  private readonly logger = new Logger(SolutionGenerationController.name);

  constructor(
    private readonly solutionGeneratorService: SolutionGeneratorService,
    private readonly difficultyGraderService: DifficultyGraderService,
    private readonly questionTaggerService: QuestionTaggerService,
    private readonly imageProcessorService: ImageProcessorService,
  ) {}

  @Post('generate')
  async generateSolution(
    @Body() questionDto: ServicableQuestion,
  ): Promise<Solution> {
    try {
      this.logger.log(`Received solution generation request for question: ${questionDto.question.substring(0, 100)}...`);

      // Validate input
      if (!questionDto.question || questionDto.question.trim().length === 0) {
        throw new HttpException('Question text is required', HttpStatus.BAD_REQUEST);
      }

      if (!questionDto.options || questionDto.options.length !== 4) {
        throw new HttpException('Exactly 4 options (A, B, C, D) are required', HttpStatus.BAD_REQUEST);
      }

      if (questionDto.options.some(option => !option || option.trim().length === 0)) {
        throw new HttpException('All options must have non-empty text', HttpStatus.BAD_REQUEST);
      }

      // Extract images from markdown if present
      const images = await this.imageProcessorService.extractAndProcessImages(
        questionDto.question + '\n' + questionDto.options.join('\n')
      );
      
      const questionWithImages = {
        ...questionDto,
        images
      };

      this.logger.log(`Processing question with ${images.length} extracted images`);

      // Generate solution first (needed for grading and classification)
      this.logger.log('Generating solution...');
      const solutionOutput = await this.solutionGeneratorService.generateSolution(questionWithImages);

      // Run difficulty grading and question tagging in parallel
      this.logger.log('Running difficulty grading and question classification in parallel...');
      const [gradingResult, classificationResult] = await Promise.all([
        this.difficultyGraderService.gradeQuestion(questionWithImages, solutionOutput.ans_description),
        this.questionTaggerService.classifyQuestion(questionWithImages, solutionOutput.ans_description)
      ]);

      // Combine all results into the comprehensive Solution response
      const comprehensiveSolution: Solution = {
        question: questionDto.question,
        options: questionDto.options,
        answer: solutionOutput.answer,
        ans_description: solutionOutput.ans_description,
        references: solutionOutput.references.map(ref => ({
          book: ref.book_title,
          chapter: ref.book_id.toString(), // Convert book_id to string for chapter field
          page_number: ref.page_start,
          paragraph_number: 1, // Default value since this isn't provided by the vector search
        })),
        subject_id: classificationResult.subject_id,
        topic_id: classificationResult.topic_id,
        category_id: classificationResult.category_id,
        difficulty: gradingResult.difficultyRating,
      };

      this.logger.log(`Comprehensive solution generated successfully for question: ${questionDto.question.substring(0, 50)}...`);
      this.logger.log(`Classification: subject=${comprehensiveSolution.subject_id}, topic=${comprehensiveSolution.topic_id}, category=${comprehensiveSolution.category_id}`);
      this.logger.log(`Difficulty: ${comprehensiveSolution.difficulty}`);
      this.logger.log(`References: ${comprehensiveSolution.references.length} books found`);

      return comprehensiveSolution;

    } catch (error) {
      this.logger.error(`Failed to generate comprehensive solution: ${error.message}`, error.stack);
      
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException(
        `Failed to generate comprehensive solution: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('test-endpoint')
  async testEndpoint(@Body() body: any): Promise<{ message: string; receivedData: any }> {
    this.logger.log('Test endpoint called');
    return {
      message: 'Solution Generator module is working',
      receivedData: {
        questionProvided: !!body.question,
        optionsCount: body.options?.length || 0,
        hasImages: !!body.images?.length,
      },
    };
  }
}
