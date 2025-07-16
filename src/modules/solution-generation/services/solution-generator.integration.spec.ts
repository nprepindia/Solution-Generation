import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SolutionGeneratorService } from './solution-generator.service';
import { ServicableQuestion } from '../dto';

describe('SolutionGeneratorService Integration Tests', () => {
  let service: SolutionGeneratorService;
  let configService: ConfigService;

  // These tests require real API credentials
  // Skip by default and run with: npm test -- --testNamePattern="Integration"
  const shouldRunIntegrationTests = process.env.RUN_INTEGRATION_TESTS === 'true';

  beforeAll(async () => {
    if (!shouldRunIntegrationTests) {
      console.log('Skipping integration tests. Set RUN_INTEGRATION_TESTS=true to run them.');
      return;
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SolutionGeneratorService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => process.env[key],
          },
        },
      ],
    }).compile();

    service = module.get<SolutionGeneratorService>(SolutionGeneratorService);
    configService = module.get<ConfigService>(ConfigService);
  });

  describe('Real API Integration', () => {
    const testQuestion: ServicableQuestion = {
      question: 'What is photosynthesis and how does it work in plants?',
      options: [
        'A process where plants convert sunlight to energy',
        'A process where plants absorb water only',
        'A process where plants produce oxygen only',
        'A process where plants break down nutrients',
      ],
    };

    beforeEach(() => {
      if (!shouldRunIntegrationTests) {
        pending('Integration tests are disabled');
      }

      // Check if required environment variables are set
      const requiredVars = ['OPENAI_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
      const missingVars = requiredVars.filter(varName => !process.env[varName]);
      
      if (missingVars.length > 0) {
        pending(`Missing required environment variables: ${missingVars.join(', ')}`);
      }
    });

    it('should generate embeddings using real OpenAI API', async () => {
      // This test will call the real OpenAI API
      const embedding = await (service as any).generateEmbedding(testQuestion.question);

      expect(embedding).toBeDefined();
      expect(Array.isArray(embedding)).toBe(true);
      expect(embedding.length).toBeGreaterThan(0);
      expect(typeof embedding[0]).toBe('number');
      
      // text-embedding-3-large should return 3072-dimensional vectors
      expect(embedding.length).toBe(3072);
    }, 30000); // 30 second timeout for API call

    it('should perform vector search using real Supabase', async () => {
      // First generate a real embedding
      const embedding = await (service as any).generateEmbedding(testQuestion.question);
      
      // Then search with it
      const results = await (service as any).performVectorSearch(embedding, 0.5, 3);

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      
      // Results might be empty if no relevant documents exist
      if (results.length > 0) {
        const firstResult = results[0];
        expect(firstResult).toHaveProperty('id');
        expect(firstResult).toHaveProperty('content');
        expect(firstResult).toHaveProperty('book');
        expect(firstResult).toHaveProperty('chapter');
        expect(firstResult).toHaveProperty('page_number');
        expect(firstResult).toHaveProperty('paragraph_number');
        expect(firstResult).toHaveProperty('similarity');
        expect(typeof firstResult.similarity).toBe('number');
      }
    }, 30000);

    it('should generate complete solution with real APIs', async () => {
      // Full end-to-end test
      const result = await service.generateSolution(testQuestion);

      expect(result).toBeDefined();
      expect(typeof result.answer).toBe('number');
      expect(result.answer).toBeGreaterThanOrEqual(1);
      expect(result.answer).toBeLessThanOrEqual(4);
      
      expect(typeof result.ans_description).toBe('string');
      expect(result.ans_description.length).toBeGreaterThan(0);
      
      expect(Array.isArray(result.references)).toBe(true);
      expect(Array.isArray(result.images)).toBe(true);
      
      // Check structure of references if any exist
      if (result.references.length > 0) {
        const firstRef = result.references[0];
        expect(firstRef).toHaveProperty('book');
        expect(firstRef).toHaveProperty('chapter');
        expect(firstRef).toHaveProperty('page_number');
        expect(firstRef).toHaveProperty('paragraph_number');
      }
      
      // Check structure of images
      if (result.images.length > 0) {
        const firstImage = result.images[0];
        expect(firstImage).toHaveProperty('is_required');
        expect(firstImage).toHaveProperty('image_description');
        expect(typeof firstImage.is_required).toBe('boolean');
        expect(typeof firstImage.image_description).toBe('string');
      }
    }, 45000); // 45 second timeout for full pipeline

    it('should handle different similarity thresholds', async () => {
      const embedding = await (service as any).generateEmbedding('test query');
      
      // Test with high threshold (should return fewer results)
      const highThresholdResults = await (service as any).performVectorSearch(embedding, 0.9, 5);
      
      // Test with low threshold (should return more results)
      const lowThresholdResults = await (service as any).performVectorSearch(embedding, 0.3, 5);
      
      expect(highThresholdResults.length).toBeLessThanOrEqual(lowThresholdResults.length);
    }, 30000);

    it('should respect match count limits', async () => {
      const embedding = await (service as any).generateEmbedding('test query');
      
      const results = await (service as any).performVectorSearch(embedding, 0.5, 2);
      
      expect(results.length).toBeLessThanOrEqual(2);
    }, 30000);
  });

  describe('Error Handling with Real APIs', () => {
    beforeEach(() => {
      if (!shouldRunIntegrationTests) {
        pending('Integration tests are disabled');
      }
    });

    it('should handle invalid Supabase configuration gracefully', async () => {
      // Create service with invalid Supabase config
      const moduleWithBadConfig = await Test.createTestingModule({
        providers: [
          SolutionGeneratorService,
          {
            provide: ConfigService,
            useValue: {
              get: (key: string) => {
                if (key === 'SUPABASE_URL') return 'https://invalid.supabase.co';
                if (key === 'SUPABASE_SERVICE_KEY') return 'invalid-key';
                return process.env[key];
              },
            },
          },
        ],
      }).compile();

      const badService = moduleWithBadConfig.get<SolutionGeneratorService>(SolutionGeneratorService);
      const testQuestion: ServicableQuestion = {
        question: 'Test question',
        options: ['A', 'B', 'C', 'D'],
      };

      await expect(badService.generateSolution(testQuestion)).rejects.toThrow();
    }, 30000);
  });

  describe('Performance Tests', () => {
    beforeEach(() => {
      if (!shouldRunIntegrationTests) {
        pending('Integration tests are disabled');
      }
    });

    it('should complete embedding generation within reasonable time', async () => {
      const startTime = Date.now();
      
      await (service as any).generateEmbedding('This is a test question for performance measurement');
      
      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(10000); // Should complete within 10 seconds
    });

    it('should handle concurrent requests', async () => {
      const questions = [
        'What is the theory of relativity?',
        'How does machine learning work?',
        'What are the principles of quantum mechanics?',
      ];

      const startTime = Date.now();
      
      const promises = questions.map(q => (service as any).generateEmbedding(q));
      const results = await Promise.all(promises);
      
      const duration = Date.now() - startTime;
      
      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(3072);
      });
      
      // Concurrent execution should be faster than sequential
      expect(duration).toBeLessThan(30000); // Should complete within 30 seconds
    }, 45000);
  });
});

/*
 * To run integration tests:
 * 
 * 1. Set up environment variables:
 *    export OPENAI_API_KEY="your-openai-key"
 *    export SUPABASE_URL="your-supabase-url"
 *    export SUPABASE_SERVICE_KEY="your-supabase-service-key"
 *    export RUN_INTEGRATION_TESTS="true"
 * 
 * 2. Ensure your Supabase database has:
 *    - A books_2025 table with vector embeddings
 *    - A match_documents RPC function for similarity search
 * 
 * 3. Run the tests:
 *    npm test -- --testNamePattern="Integration"
 *    
 * Note: These tests will make real API calls and may incur costs.
 */ 