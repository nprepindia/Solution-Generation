import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SolutionGeneratorService } from './solution-generator.service';
import { ServicableQuestion, SolutionOutputDto } from '../dto';
import { LLMGenerationError } from '../../../common/exceptions';

// Mock Gemini AI
const mockGeminiAI = {
  getGenerativeModel: jest.fn(),
};

// Mock Supabase
const mockSupabase = {
  rpc: jest.fn(),
};

// Mock model instance - updated for direct generateContent approach
const mockModel = {
  generateContent: jest.fn(),
  embedContent: jest.fn(),
};

// Mock response
const mockResponse = {
  response: {
    functionCalls: jest.fn(),
    text: jest.fn(),
  },
};

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => mockGeminiAI),
  SchemaType: {
    OBJECT: 'OBJECT',
    STRING: 'STRING',
    INTEGER: 'INTEGER',
    ARRAY: 'ARRAY',
    NUMBER: 'NUMBER',
    BOOLEAN: 'BOOLEAN',
  },
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockSupabase),
}));

describe('SolutionGeneratorService', () => {
  let service: SolutionGeneratorService;
  let configService: ConfigService;
  let mockConfig: any;

  // Mock constants used throughout tests
  const mockEmbedding = new Array(768).fill(0.1);
  
  const mockQuestion: ServicableQuestion = {
    question: 'What is the normal heart rate for an adult?',
    options: [
      'A. 40-60 beats per minute',
      'B. 60-100 beats per minute',
      'C. 100-120 beats per minute',
      'D. 120-140 beats per minute',
    ],
  };

  const mockVectorSearchResults = [
    {
      id: '1',
      content: 'Normal heart rate for adults is 60-100 beats per minute.',
      book: 'Fundamentals of Nursing',
      chapter: 'Vital Signs',
      page_number: 245,
      paragraph_number: 3,
      similarity: 0.95,
    },
    {
      id: '2',
      content: 'Heart rate varies with age, fitness level, and health conditions.',
      book: 'Medical-Surgical Nursing',
      chapter: 'Cardiovascular Assessment',
      page_number: 112,
      paragraph_number: 1,
      similarity: 0.87,
    },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SolutionGeneratorService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config = {
                GOOGLE_API_KEY: 'test-google-api-key',
                SUPABASE_URL: 'https://test.supabase.co',
                SUPABASE_SERVICE_KEY: 'test-service-key',
              };
              return config[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<SolutionGeneratorService>(SolutionGeneratorService);
    configService = module.get<ConfigService>(ConfigService);

    // Setup default mocks
    mockGeminiAI.getGenerativeModel.mockReturnValue(mockModel);
    mockModel.embedContent.mockResolvedValue({
      embedding: { values: mockEmbedding },
    });
    mockSupabase.rpc.mockResolvedValue({
      data: mockVectorSearchResults,
      error: null,
    });

    // Set up default successful response with no function calls (final answer)
    mockModel.generateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          answer: 0,
          ans_description: 'Test answer description',
          references: [{
            book: 'Test Book',
            chapter: 'Test Chapter',
            page_number: 100,
            paragraph_number: 1
          }],
          images: [{
            is_required: false,
            image_description: 'Test image description'
          }]
        }),
        functionCalls: () => [], // Return empty array instead of null to prevent errors
      }
    });

    // Mock Supabase vector search
    mockSupabase.rpc.mockResolvedValue({
      data: [{
        id: '123',
        content: 'Test content',
        book: 'Test Book',
        chapter: 'Test Chapter',
        page_number: 100,
        paragraph_number: 1,
        similarity: 0.9
      }]
    });

    // Mock embedding generation with correct size (768, not 1536)
    mockModel.embedContent.mockResolvedValue({
      embedding: {
        values: new Array(768).fill(0.1) // OpenAI text-embedding-3-large is 1536, but test expects 768
      }
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Configuration', () => {
    it('should initialize with correct configuration', () => {
      // Service is properly initialized as verified by other tests
      expect(service).toBeDefined();
      expect(configService).toBeDefined();
    });
  });

  describe('generate method (Task 5 implementation)', () => {
    const customSystemMessage = 'Custom nursing expert prompt for testing';

    // Helper function to setup default successful mocks for tests that need them
    const setupSuccessfulMocks = () => {
      // Setup embedding mock
      mockModel.embedContent.mockResolvedValue({
        embedding: { values: mockEmbedding }
      });
      
      // Setup vector search mock  
      mockSupabase.rpc.mockResolvedValue({
        data: mockVectorSearchResults,
        error: null,
      });
      
      // Set up the function calling sequence:
      const mockEmbeddingCallResponse = {
        functionCalls: () => [
          { name: 'generateEmbedding', args: { text: 'What is the normal heart rate for an adult?' } },
        ],
        text: () => '',
      };

      const mockVectorSearchCallResponse = {
        functionCalls: () => [
          { name: 'vectorSearch', args: { embedding: mockEmbedding, limit: 5 } },
        ],
        text: () => '',
      };

      const mockFinalResponse = {
        functionCalls: () => [], // No more function calls
        text: () => JSON.stringify({
          answer: 1,
          ans_description: '60-100 beats per minute is the normal range for adults.',
          references: [{
            book: 'Fundamentals of Nursing',
            chapter: 'Vital Signs',
            page_number: 245,
            paragraph_number: 3
          }],
          images: [{
            is_required: true,
            image_description: 'Diagram showing normal heart rate ranges'
          }]
        }),
      };

      // Mock the sequence of generateContent calls
      mockModel.generateContent
        .mockResolvedValueOnce({ response: mockEmbeddingCallResponse })
        .mockResolvedValueOnce({ response: mockVectorSearchCallResponse })
        .mockResolvedValueOnce({ response: mockFinalResponse });
    };

    beforeEach(() => {
      // Always reset all mocks
      jest.clearAllMocks();
    });

    it('should generate solution with custom system message', async () => {
      setupSuccessfulMocks();
      
      const result = await service.generate(mockQuestion, customSystemMessage);

      expect(result).toBeDefined();
      expect(result.answer).toBe(1);
      expect(result.ans_description).toContain('60-100 beats per minute');
      expect(result.references).toHaveLength(1);
      expect(result.references[0].book).toBe('Fundamentals of Nursing');
      expect(result.images).toHaveLength(1);
      expect(result.images[0].is_required).toBe(true);
    });

    it('should format user message correctly', async () => {
      setupSuccessfulMocks();
      
      await service.generate(mockQuestion, customSystemMessage);

      // Verify the model was called with the correct multimodal content structure
      expect(mockModel.generateContent).toHaveBeenCalledWith({
        contents: [
          {
            parts: [
              {
                text: expect.stringContaining('Question: What is the normal heart rate for an adult?'),
              },
            ],
            role: 'user',
          },
        ],
      });

      // Get the actual call arguments to verify content
      const callArgs = mockModel.generateContent.mock.calls[0][0];
      const userMessage = callArgs.contents[0].parts[0].text;
      
      expect(userMessage).toContain('Question: What is the normal heart rate for an adult?');
      expect(userMessage).toContain('40-60 beats per minute');
      expect(userMessage).toContain('60-100 beats per minute');
      expect(userMessage).toContain('100-120 beats per minute');
      expect(userMessage).toContain('120-140 beats per minute');
    });

    it('should handle function calling for embedding generation', async () => {
      setupSuccessfulMocks();
      
      await service.generate(mockQuestion, customSystemMessage);

      expect(mockModel.embedContent).toHaveBeenCalledWith('What is the normal heart rate for an adult?');
    });

    it('should handle function calling for vector search', async () => {
      setupSuccessfulMocks();
      
      await service.generate(mockQuestion, customSystemMessage);

      expect(mockSupabase.rpc).toHaveBeenCalledWith('match_documents', {
        query_embedding: mockEmbedding,
        match_threshold: 0.7,
        match_count: 5,
      });
    });

    it('should validate response structure', async () => {
      setupSuccessfulMocks();
      
      const result = await service.generate(mockQuestion, customSystemMessage);

      expect(typeof result.answer).toBe('number');
      expect(result.answer).toBeGreaterThanOrEqual(0);
      expect(result.answer).toBeLessThanOrEqual(3);
      expect(typeof result.ans_description).toBe('string');
      expect(result.ans_description.length).toBeGreaterThan(0);
      expect(Array.isArray(result.references)).toBe(true);
      expect(Array.isArray(result.images)).toBe(true);
    });

    it('should handle invalid JSON response from Gemini', async () => {
      // Setup embedding mock
      mockModel.embedContent.mockResolvedValue({
        embedding: { values: mockEmbedding }
      });
      
      // Setup vector search mock  
      mockSupabase.rpc.mockResolvedValue({
        data: mockVectorSearchResults,
        error: null,
      });

      // Define mock responses for this test
      const mockEmbeddingCallResponse = {
        functionCalls: () => [
          { name: 'generateEmbedding', args: { text: 'What is the normal heart rate for an adult?' } },
        ],
        text: () => '',
      };

      const mockVectorSearchCallResponse = {
        functionCalls: () => [
          { name: 'vectorSearch', args: { embedding: mockEmbedding, limit: 5 } },
        ],
        text: () => '',
      };

      const mockInvalidFinalResponse = {
        functionCalls: () => null, // No more function calls  
        text: () => 'invalid json that cannot be parsed', // Invalid JSON that should cause error
      };

      // Mock the full sequence of calls leading to the invalid response
      mockModel.generateContent
        .mockResolvedValueOnce({ response: mockEmbeddingCallResponse })
        .mockResolvedValueOnce({ response: mockVectorSearchCallResponse })
        .mockResolvedValueOnce({ response: mockInvalidFinalResponse });

      await expect(service.generate(mockQuestion, customSystemMessage)).rejects.toThrow('Invalid JSON response from Gemini');
    });

    it('should handle embedding generation errors', async () => {
      // Clear all mocks first
      jest.clearAllMocks();
      
      mockModel.embedContent.mockRejectedValueOnce(new Error('Embedding failed'));

      const mockFunctionCallResponse = {
        functionCalls: () => [
          { name: 'generateEmbedding', args: { text: 'What is the normal heart rate for an adult?' } },
        ],
        text: () => '',
      };

      mockModel.generateContent.mockResolvedValueOnce({ response: mockFunctionCallResponse });

      await expect(service.generate(mockQuestion, customSystemMessage)).rejects.toThrow(
        'Embedding failed',
      );
    });

    it('should handle vector search errors', async () => {
      // Clear all mocks first
      jest.clearAllMocks();
      
      // Setup embedding mock first
      mockModel.embedContent.mockResolvedValue({
        embedding: { values: mockEmbedding }
      });
      
      mockSupabase.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'Database connection error' },
      });

      const mockEmbeddingCallResponse = {
        functionCalls: () => [
          { name: 'generateEmbedding', args: { text: 'What is the normal heart rate for an adult?' } },
        ],
        text: () => '',
      };

      const mockVectorSearchCallResponse = {
        functionCalls: () => [
          { name: 'vectorSearch', args: { embedding: mockEmbedding } },
        ],
        text: () => '',
      };

      mockModel.generateContent
        .mockResolvedValueOnce({ response: mockEmbeddingCallResponse })
        .mockResolvedValueOnce({ response: mockVectorSearchCallResponse });

      await expect(service.generate(mockQuestion, customSystemMessage)).rejects.toThrow(
        'Database connection error',
      );
    });

    it('should handle validation errors', async () => {
      // Setup embedding mock
      mockModel.embedContent.mockResolvedValue({
        embedding: { values: mockEmbedding }
      });
      
      // Setup vector search mock  
      mockSupabase.rpc.mockResolvedValue({
        data: mockVectorSearchResults,
        error: null,
      });

      const mockEmbeddingCallResponse = {
        functionCalls: () => [
          { name: 'generateEmbedding', args: { text: 'What is the normal heart rate for an adult?' } },
        ],
        text: () => '',
      };

      const mockVectorSearchCallResponse = {
        functionCalls: () => [
          { name: 'vectorSearch', args: { embedding: mockEmbedding, limit: 5 } },
        ],
        text: () => '',
      };

      const mockInvalidResponse = {
        functionCalls: () => null,
        text: () => JSON.stringify({
          answer: 5, // Invalid: should be 0-3
          ans_description: 'Test description',
          references: [],
          images: [],
        }),
      };

      // Mock the sequence of generateContent calls
      mockModel.generateContent
        .mockResolvedValueOnce({ response: mockEmbeddingCallResponse })
        .mockResolvedValueOnce({ response: mockVectorSearchCallResponse })
        .mockResolvedValueOnce({ response: mockInvalidResponse });

      await expect(service.generate(mockQuestion, customSystemMessage)).rejects.toThrow(
        'Answer must be between 0 and 3',
      );
    });
  });

  describe('generateSolution method (legacy compatibility)', () => {
    beforeEach(() => {
      // Clear all mocks to avoid conflicts
      jest.clearAllMocks();
      
      // Setup embedding mock
      mockModel.embedContent.mockResolvedValue({
        embedding: { values: mockEmbedding }
      });
      
      // Setup vector search mock  
      mockSupabase.rpc.mockResolvedValue({
        data: mockVectorSearchResults,
        error: null,
      });

      // Setup the function call sequence for legacy method
      const mockEmbeddingCallResponse = {
        functionCalls: () => [
          { name: 'generateEmbedding', args: { text: 'What is the normal heart rate for an adult?' } },
        ],
        text: () => '',
      };

      const mockVectorSearchCallResponse = {
        functionCalls: () => [
          { name: 'vectorSearch', args: { embedding: mockEmbedding, limit: 5 } },
        ],
        text: () => '',
      };

      const mockFinalResponse = {
        functionCalls: () => null,
        text: () => JSON.stringify({
          answer: 1,
          ans_description: 'Solution with default system message.',
          references: [{
            book: 'Test Book',
            chapter: 'Test Chapter', 
            page_number: 100,
            paragraph_number: 1,
          }],
          images: [],
        }),
      };

      // Mock the sequence of generateContent calls
      mockModel.generateContent
        .mockResolvedValueOnce({ response: mockEmbeddingCallResponse })
        .mockResolvedValueOnce({ response: mockVectorSearchCallResponse })
        .mockResolvedValueOnce({ response: mockFinalResponse });
    });

    it('should generate solution with default system message', async () => {
      const result = await service.generateSolution(mockQuestion);

      expect(result).toBeDefined();
      expect(result.answer).toBe(1);
      expect(result.ans_description).toContain('Solution with default system message');
      expect(result.references).toHaveLength(1); // Should have 1 reference from mockVectorSearchResults
    });

    it('should use nursing domain default system message', async () => {
      await service.generateSolution(mockQuestion);

      // With the new approach, system message is passed to getGenerativeModel, not in chat history
      expect(mockGeminiAI.getGenerativeModel).toHaveBeenCalledWith({
        model: 'gemini-1.5-pro',
        tools: expect.any(Array),
        systemInstruction: expect.stringContaining('expert solution writer for nursing domain'),
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: expect.any(Object),
        },
      });
    });

    it('should handle empty vector search results', async () => {
      // Clear all mocks first
      jest.clearAllMocks();
      
      // Setup embedding mock
      mockModel.embedContent.mockResolvedValue({
        embedding: { values: mockEmbedding }
      });
      
      // Mock empty vector search results
      mockSupabase.rpc.mockResolvedValue({
        data: [],
        error: null,
      });

      // Setup the function call sequence for empty results
      const mockEmbeddingCallResponse = {
        functionCalls: () => [
          { name: 'generateEmbedding', args: { text: 'What is the normal heart rate for an adult?' } },
        ],
        text: () => '',
      };

      const mockVectorSearchCallResponse = {
        functionCalls: () => [
          { name: 'vectorSearch', args: { embedding: mockEmbedding, limit: 5 } },
        ],
        text: () => '',
      };

      const mockEmptyContextResponse = {
        functionCalls: () => null,
        text: () => JSON.stringify({
          answer: 1,
          ans_description: 'Solution based on general knowledge when no context found.',
          references: [],
          images: [],
        }),
      };

      // Mock the sequence of generateContent calls
      mockModel.generateContent
        .mockResolvedValueOnce({ response: mockEmbeddingCallResponse })
        .mockResolvedValueOnce({ response: mockVectorSearchCallResponse })
        .mockResolvedValueOnce({ response: mockEmptyContextResponse });

      const result = await service.generateSolution(mockQuestion);

      expect(result).toBeDefined();
      expect(result.references).toHaveLength(0);
      expect(result.ans_description).toContain('general knowledge');
    });
  });

  describe('Error Handling', () => {
    it('should handle Gemini API configuration errors', () => {
      const invalidConfigService = {
        get: jest.fn((key: string) => {
          if (key === 'GOOGLE_API_KEY') return undefined;
          return 'test-value';
        }),
      };

      expect(() => {
        new SolutionGeneratorService(invalidConfigService as any);
      }).toThrow('GOOGLE_API_KEY is required');
    });

    it('should handle Supabase configuration errors', () => {
      const invalidConfigService = {
        get: jest.fn((key: string) => {
          if (key === 'SUPABASE_URL') return undefined;
          return 'test-value';
        }),
      };

      expect(() => {
        new SolutionGeneratorService(invalidConfigService as any);
      }).toThrow('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
    });

    it('should handle unknown function calls', async () => {
      const mockUnknownFunctionResponse = {
        functionCalls: () => [
          { name: 'unknownFunction', args: {} },
        ],
        text: () => '',
      };

      mockModel.generateContent.mockResolvedValueOnce({ response: mockUnknownFunctionResponse });

      await expect(service.generate(mockQuestion, 'test')).rejects.toThrow(
        'Unknown function: unknownFunction',
      );
    });
  });

  describe('Function Call Handlers', () => {
    it('should handle generateEmbedding function with correct parameters', async () => {
      const handler = (service as any).handleGenerateEmbedding.bind(service);
      const args = { text: 'test question' };

      const result = await handler(args);

      expect(result).toEqual({
        embedding: mockEmbedding,
        dimensions: 768,
      });
      expect(mockModel.embedContent).toHaveBeenCalledWith('test question');
    });

    it('should handle vectorSearch function with correct parameters', async () => {
      // Setup mock to return 2 results as expected
      mockSupabase.rpc.mockResolvedValueOnce({
        data: mockVectorSearchResults, // This contains 2 results
        error: null,
      });

      const handler = (service as any).handleVectorSearch.bind(service);
      const args = { embedding: mockEmbedding, limit: 3 };

      const result = await handler(args);

      expect(result.count).toBe(2);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].content).toBe(mockVectorSearchResults[0].content);
      expect(mockSupabase.rpc).toHaveBeenCalledWith('match_documents', {
        query_embedding: mockEmbedding,
        match_threshold: 0.7,
        match_count: 3,
      });
    });

    it('should use default limit in vectorSearch when not provided', async () => {
      const handler = (service as any).handleVectorSearch.bind(service);
      const args = { embedding: mockEmbedding };

      await handler(args);

      expect(mockSupabase.rpc).toHaveBeenCalledWith('match_documents', {
        query_embedding: mockEmbedding,
        match_threshold: 0.7,
        match_count: 5,
      });
    });
  });

  describe('Response Validation', () => {
    it('should validate correct response structure', async () => {
      const validResponse = {
        answer: 2,
        ans_description: 'Valid description',
        references: [
          {
            book: 'Test Book',
            chapter: 'Test Chapter',
            page_number: 10,
            paragraph_number: 1,
          },
        ],
        images: [
          {
            is_required: false,
            image_description: 'Test image',
          },
        ],
      };

      const validator = (service as any).validateAndTransformResponse.bind(service);
      const result = await validator(validResponse);
      expect(result).toEqual(validResponse);
    });

    it('should reject invalid answer range', async () => {
      const invalidResponse = {
        answer: 5,
        ans_description: 'Valid description',
        references: [],
        images: [],
      };

      const validator = (service as any).validateAndTransformResponse.bind(service);
      await expect(validator(invalidResponse)).rejects.toThrow(
        'Answer must be between 0 and 3',
      );
    });

    it('should reject empty description', async () => {
      const invalidResponse = {
        answer: 1,
        ans_description: '',
        references: [],
        images: [],
      };

      const validator = (service as any).validateAndTransformResponse.bind(service);
      await expect(validator(invalidResponse)).rejects.toThrow(
        'Answer description cannot be empty',
      );
    });
  });
}); 