import { Test, TestingModule } from '@nestjs/testing';
import { SolutionGenerationController } from './solution-generation.controller';

describe('SolutionGenerationController', () => {
  let controller: SolutionGenerationController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SolutionGenerationController],
    }).compile();

    controller = module.get<SolutionGenerationController>(SolutionGenerationController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
