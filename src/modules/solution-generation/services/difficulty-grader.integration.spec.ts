import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DifficultyGraderService } from './difficulty-grader.service';
import { ServicableQuestion, GradingOutputDto } from '../dto';

describe('DifficultyGraderService (Integration)', () => {
  let service: DifficultyGraderService;
  let configService: ConfigService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DifficultyGraderService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              // Use real environment variables for integration tests
              return process.env[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<DifficultyGraderService>(DifficultyGraderService);
    configService = module.get<ConfigService>(ConfigService);
  });

  // Skip integration tests if no API key is provided
  const skipIfNoApiKey = () => {
    if (!process.env.GOOGLE_API_KEY) {
      console.log('Skipping integration tests - GOOGLE_API_KEY not provided');
      return true;
    }
    return false;
  };

  describe('Real API Integration Tests', () => {
    it('should grade an easy question correctly', async () => {
      if (skipIfNoApiKey()) return;

      const easyQuestion: ServicableQuestion = {
        question: 'What is the normal body temperature in Celsius?',
        options: ['35°C', '37°C', '39°C', '41°C'],
      };

      const easySolution = 'Normal body temperature is 37°C (98.6°F). This is a well-established medical fact that requires direct recall of knowledge.';

      const result = await service.gradeQuestion(easyQuestion, easySolution);

      expect(result).toBeInstanceOf(GradingOutputDto);
      expect(result.difficultyRating).toBe('easy');
    }, 30000); // 30 second timeout for API calls

    it('should grade a medium question correctly', async () => {
      if (skipIfNoApiKey()) return;

      const mediumQuestion: ServicableQuestion = {
        question: 'A patient has a heart rate of 110 bpm while at rest. What condition does this most likely indicate?',
        options: ['Bradycardia', 'Tachycardia', 'Normal heart rate', 'Arrhythmia'],
      };

      const mediumSolution = 'Since normal resting heart rate is 60-100 bpm, a rate of 110 bpm is above normal range, indicating tachycardia. This requires one level of inference: knowing the normal range and comparing the given value.';

      const result = await service.gradeQuestion(mediumQuestion, mediumSolution);

      expect(result).toBeInstanceOf(GradingOutputDto);
      expect(result.difficultyRating).toBe('medium');
    }, 30000);

    it('should grade a hard question correctly', async () => {
      if (skipIfNoApiKey()) return;

      const hardQuestion: ServicableQuestion = {
        question: 'A 65-year-old patient with diabetes presents with chest pain, elevated troponins, and ST-segment changes. Considering the patient\'s comorbidities and presenting symptoms, what is the most appropriate immediate intervention?',
        options: [
          'Administer insulin for blood sugar control',
          'Start anticoagulation therapy immediately',
          'Perform emergency cardiac catheterization',
          'Increase diabetes medication dosage',
        ],
      };

      const hardSolution = 'This question requires multiple levels of reasoning: 1) Recognizing signs of myocardial infarction (chest pain, elevated troponins, ST changes), 2) Understanding that diabetes increases cardiac risk, 3) Prioritizing cardiac intervention over diabetes management in acute setting, 4) Knowing that emergency catheterization is the gold standard for STEMI. Multiple clinical concepts must be integrated.';

      const result = await service.gradeQuestion(hardQuestion, hardSolution);

      expect(result).toBeInstanceOf(GradingOutputDto);
      expect(result.difficultyRating).toBe('hard');
    }, 30000);

    it('should handle questions with medical terminology', async () => {
      if (skipIfNoApiKey()) return;

      const medicalQuestion: ServicableQuestion = {
        question: 'What does the abbreviation "NPO" mean in medical contexts?',
        options: [
          'Nothing by mouth',
          'No pain observed',
          'Normal pulse only',
          'Non-prescription oral',
        ],
      };

      const medicalSolution = 'NPO stands for "nil per os" which means "nothing by mouth" in Latin. This is direct recall of medical terminology.';

      const result = await service.gradeQuestion(medicalQuestion, medicalSolution);

      expect(result).toBeInstanceOf(GradingOutputDto);
      expect(['easy', 'medium', 'hard']).toContain(result.difficultyRating);
      // Most likely easy since it's direct terminology recall
      expect(result.difficultyRating).toBe('easy');
    }, 30000);

    it('should handle complex pathophysiology questions', async () => {
      if (skipIfNoApiKey()) return;

      const complexQuestion: ServicableQuestion = {
        question: 'In a patient with chronic kidney disease, which mechanism best explains the development of secondary hyperparathyroidism?',
        options: [
          'Decreased calcium absorption in the intestines',
          'Increased phosphate retention leading to decreased ionized calcium',
          'Direct damage to parathyroid glands from uremic toxins',
          'Increased vitamin D synthesis by failing kidneys',
        ],
      };

      const complexSolution = 'Secondary hyperparathyroidism in CKD develops through: 1) Kidneys fail to excrete phosphate → hyperphosphatemia, 2) High phosphate binds calcium → hypocalcemia, 3) Kidneys can\'t convert 25(OH)D to active 1,25(OH)2D → decreased calcium absorption, 4) Low calcium stimulates PTH release. This requires understanding multiple interconnected pathophysiological processes.';

      const result = await service.gradeQuestion(complexQuestion, complexSolution);

      expect(result).toBeInstanceOf(GradingOutputDto);
      expect(result.difficultyRating).toBe('hard');
    }, 30000);
  });

  describe('Error Handling Integration', () => {
    it('should handle service initialization with missing API key', async () => {
      if (process.env.GOOGLE_API_KEY) {
        // Temporarily remove API key to test error handling
        const originalKey = process.env.GOOGLE_API_KEY;
        delete process.env.GOOGLE_API_KEY;

        const invalidConfigService = {
          get: jest.fn((key: string) => {
            if (key === 'GOOGLE_API_KEY') return undefined;
            return process.env[key];
          }),
        };

        expect(() => {
          new DifficultyGraderService(invalidConfigService as any);
        }).toThrow('GOOGLE_API_KEY is required');

        // Restore API key
        process.env.GOOGLE_API_KEY = originalKey;
      }
    });
  });

  describe('Performance Tests', () => {
    it('should complete grading within reasonable time', async () => {
      if (skipIfNoApiKey()) return;

      const question: ServicableQuestion = {
        question: 'What is the primary function of red blood cells?',
        options: [
          'Fighting infections',
          'Carrying oxygen',
          'Blood clotting',
          'Producing antibodies',
        ],
      };

      const solution = 'Red blood cells (erythrocytes) primarily carry oxygen from lungs to tissues via hemoglobin.';

      const startTime = Date.now();
      const result = await service.gradeQuestion(question, solution);
      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(result).toBeInstanceOf(GradingOutputDto);
      expect(duration).toBeLessThan(10000); // Should complete within 10 seconds
    }, 15000);

    it('should handle concurrent requests', async () => {
      if (skipIfNoApiKey()) return;

      const questions = [
        {
          question: { question: 'What is glucose?', options: ['Sugar', 'Protein', 'Fat', 'Vitamin'] },
          solution: 'Glucose is a simple sugar and primary energy source for cells.',
        },
        {
          question: { question: 'Where is insulin produced?', options: ['Liver', 'Pancreas', 'Kidney', 'Heart'] },
          solution: 'Insulin is produced by beta cells in the pancreatic islets of Langerhans.',
        },
        {
          question: { question: 'What causes Type 1 diabetes?', options: ['Diet', 'Autoimmune destruction', 'Obesity', 'Age'] },
          solution: 'Type 1 diabetes is caused by autoimmune destruction of pancreatic beta cells that produce insulin.',
        },
      ];

      const promises = questions.map(({ question, solution }) =>
        service.gradeQuestion(question, solution)
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result).toBeInstanceOf(GradingOutputDto);
        expect(['easy', 'medium', 'hard']).toContain(result.difficultyRating);
      });
    }, 30000);
  });
}); 