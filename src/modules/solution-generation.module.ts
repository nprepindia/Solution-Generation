import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { SolutionGenerationController } from './solution-generation.controller';
import { SolutionGeneratorService } from './solution-generation/services/solution-generator.service';
import { ImageProcessorService } from './solution-generation/services/image-processor.service';
import { DifficultyGraderService } from './solution-generation/services/difficulty-grader.service';
import { QuestionTaggerService } from './solution-generation/services/question-tagger.service';

@Module({
  imports: [
    ConfigModule,
    HttpModule, // Required for API calls in QuestionTaggerService
  ],
  controllers: [SolutionGenerationController],
  providers: [
    SolutionGeneratorService, 
    ImageProcessorService,
    DifficultyGraderService,
    QuestionTaggerService,
  ],
  exports: [
    SolutionGeneratorService, 
    ImageProcessorService,
    DifficultyGraderService,
    QuestionTaggerService,
  ]
})
export class SolutionGenerationModule {}
