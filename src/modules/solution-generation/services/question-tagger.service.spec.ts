import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { AxiosResponse } from 'axios';
import { QuestionTaggerService, SubjectResponse, TopicResponse, CategoryResponse } from './question-tagger.service';
import { ApiRequestError } from '../../../common/exceptions/api-request.exception';

describe('QuestionTaggerService', () => {
  let service: QuestionTaggerService;
  let httpService: jest.Mocked<HttpService>;
  let configService: jest.Mocked<ConfigService>;

  const mockToken = 'Bearer test-token-123';
  const baseUrl = 'https://api.nprep.in/v3/admin';

  beforeEach(async () => {
    const mockHttpService = {
      get: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn(),
    };

    // Setup default config service mock before module creation
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'NPREP_API_BEARER_TOKEN') {
        return mockToken;
      }
      if (key === 'GOOGLE_API_KEY') {
        return 'mock-google-api-key-123';
      }
      return undefined;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuestionTaggerService,
        {
          provide: HttpService,
          useValue: mockHttpService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<QuestionTaggerService>(QuestionTaggerService);
    httpService = module.get(HttpService) as jest.Mocked<HttpService>;
    configService = module.get(ConfigService) as jest.Mocked<ConfigService>;
  });

  describe('getSubjects', () => {
    const mockSubjectsResponse: SubjectResponse[] = [
      { id: 1, name: 'Mathematics' },
      { id: 2, name: 'Physics' },
      { id: 3, name: 'Chemistry' },
    ];

    it('should fetch subjects successfully', async () => {
      const mockAxiosResponse: AxiosResponse = {
        data: mockSubjectsResponse,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      httpService.get.mockReturnValue(of(mockAxiosResponse));

      // Use reflection to access private method
      const result = await (service as any).getSubjects();

      expect(result).toEqual(mockSubjectsResponse);
      expect(httpService.get).toHaveBeenCalledWith(`${baseUrl}/subject`, {
        headers: {
          Authorization: `Bearer ${mockToken}`,
        },
        params: {
          fields: 'id,name',
        },
      });
    });

    it('should throw ApiRequestError when token is not configured', async () => {
      configService.get.mockReturnValue(undefined);

      await expect((service as any).getSubjects()).rejects.toThrow(
        'NPREP API Bearer token not configured',
      );

      expect(httpService.get).not.toHaveBeenCalled();
    });

    it('should throw ApiRequestError for non-200 status codes', async () => {
      const mockAxiosResponse: AxiosResponse = {
        data: null,
        status: 404,
        statusText: 'Not Found',
        headers: {},
        config: {} as any,
      };

      httpService.get.mockReturnValue(of(mockAxiosResponse));

      await expect((service as any).getSubjects()).rejects.toThrow(
        'Failed to fetch subjects: HTTP 404',
      );
    });

    it('should handle HTTP request errors', async () => {
      const mockError = new Error('Network Error');
      (mockError as any).response = { status: 500 };

      httpService.get.mockReturnValue(throwError(() => mockError));

      await expect((service as any).getSubjects()).rejects.toThrow(
        'Failed to fetch subjects from API',
      );
    });

    it('should handle HTTP request errors without response', async () => {
      const mockError = new Error('Network Error');

      httpService.get.mockReturnValue(throwError(() => mockError));

      await expect((service as any).getSubjects()).rejects.toThrow(
        'Failed to fetch subjects from API',
      );
    });
  });

  describe('getTopics', () => {
    const subjectId = 1;
    const mockTopicsResponse: TopicResponse[] = [
      { id: 1, name: 'Algebra' },
      { id: 2, name: 'Geometry' },
    ];

    it('should fetch topics for a subject successfully', async () => {
      const mockAxiosResponse: AxiosResponse = {
        data: mockTopicsResponse,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      httpService.get.mockReturnValue(of(mockAxiosResponse));

      const result = await (service as any).getTopics(subjectId);

      expect(result).toEqual(mockTopicsResponse);
      expect(httpService.get).toHaveBeenCalledWith(`${baseUrl}/topic`, {
        headers: {
          Authorization: `Bearer ${mockToken}`,
        },
        params: {
          filters: `subject_id||$eq||${subjectId}`,
          fields: 'id,name',
        },
      });
    });

    it('should throw ApiRequestError when token is not configured', async () => {
      configService.get.mockReturnValue(undefined);

      await expect((service as any).getTopics(subjectId)).rejects.toThrow(
        'NPREP API Bearer token not configured',
      );

      expect(httpService.get).not.toHaveBeenCalled();
    });

    it('should throw ApiRequestError for non-200 status codes', async () => {
      const mockAxiosResponse: AxiosResponse = {
        data: null,
        status: 403,
        statusText: 'Forbidden',
        headers: {},
        config: {} as any,
      };

      httpService.get.mockReturnValue(of(mockAxiosResponse));

      await expect((service as any).getTopics(subjectId)).rejects.toThrow(
        `Failed to fetch topics for subject ${subjectId}: HTTP 403`,
      );
    });

    it('should handle HTTP request errors', async () => {
      const mockError = new Error('Timeout Error');
      (mockError as any).response = { status: 408 };

      httpService.get.mockReturnValue(throwError(() => mockError));

      await expect((service as any).getTopics(subjectId)).rejects.toThrow(
        `Failed to fetch topics for subject ${subjectId} from API`,
      );
    });
  });

  describe('getCategories', () => {
    const topicId = 1;
    const mockCategoriesResponse: CategoryResponse[] = [
      { id: 1, name: 'Basic Algebra' },
      { id: 2, name: 'Advanced Algebra' },
    ];

    it('should fetch categories for a topic successfully', async () => {
      const mockAxiosResponse: AxiosResponse = {
        data: mockCategoriesResponse,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      httpService.get.mockReturnValue(of(mockAxiosResponse));

      const result = await (service as any).getCategories(topicId);

      expect(result).toEqual(mockCategoriesResponse);
      expect(httpService.get).toHaveBeenCalledWith(`${baseUrl}/question-category`, {
        headers: {
          Authorization: `Bearer ${mockToken}`,
        },
        params: {
          filters: `topic_id||$eq||${topicId}`,
          fields: 'id,name',
        },
      });
    });

    it('should throw ApiRequestError when token is not configured', async () => {
      configService.get.mockReturnValue(undefined);

      await expect((service as any).getCategories(topicId)).rejects.toThrow(
        'NPREP API Bearer token not configured',
      );

      expect(httpService.get).not.toHaveBeenCalled();
    });

    it('should throw ApiRequestError for non-200 status codes', async () => {
      const mockAxiosResponse: AxiosResponse = {
        data: null,
        status: 401,
        statusText: 'Unauthorized',
        headers: {},
        config: {} as any,
      };

      httpService.get.mockReturnValue(of(mockAxiosResponse));

      await expect((service as any).getCategories(topicId)).rejects.toThrow(
        `Failed to fetch categories for topic ${topicId}: HTTP 401`,
      );
    });

    it('should handle HTTP request errors', async () => {
      const mockError = new Error('Service Unavailable');
      (mockError as any).response = { status: 503 };

      httpService.get.mockReturnValue(throwError(() => mockError));

      await expect((service as any).getCategories(topicId)).rejects.toThrow(
        `Failed to fetch categories for topic ${topicId} from API`,
      );
    });
  });

  describe('validateAndTransformResponse', () => {

    it('should validate and return valid classification output without transformation', async () => {
      const mockResponse = {
        subject_id: 1,
        topic_id: 5,
        category_id: 10,
      };

      const result = await (service as any).validateAndTransformResponse(mockResponse);

      expect(result).toEqual({
        subject_id: 1,
        topic_id: 5,
        category_id: 10,
      });
    });

    it('should transform topic_id 0 to null', async () => {
      const mockResponse = {
        subject_id: 1,
        topic_id: 0,
        category_id: 10,
      };

      const result = await (service as any).validateAndTransformResponse(mockResponse);

      expect(result).toEqual({
        subject_id: 1,
        topic_id: null,
        category_id: 10,
      });
    });

    it('should transform category_id 0 to null', async () => {
      const mockResponse = {
        subject_id: 1,
        topic_id: 5,
        category_id: 0,
      };

      const result = await (service as any).validateAndTransformResponse(mockResponse);

      expect(result).toEqual({
        subject_id: 1,
        topic_id: 5,
        category_id: null,
      });
    });

    it('should transform both topic_id and category_id 0 to null', async () => {
      const mockResponse = {
        subject_id: 1,
        topic_id: 0,
        category_id: 0,
      };

      const result = await (service as any).validateAndTransformResponse(mockResponse);

      expect(result).toEqual({
        subject_id: 1,
        topic_id: null,
        category_id: null,
      });
    });

    it('should throw error for null or undefined response', async () => {
      await expect((service as any).validateAndTransformResponse(null)).rejects.toThrow(
        'Invalid classification response format: Response must be a valid object',
      );

      await expect((service as any).validateAndTransformResponse(undefined)).rejects.toThrow(
        'Invalid classification response format: Response must be a valid object',
      );
    });

    it('should throw error for non-object response', async () => {
      await expect((service as any).validateAndTransformResponse('string')).rejects.toThrow(
        'Invalid classification response format: Response must be a valid object',
      );

      await expect((service as any).validateAndTransformResponse(123)).rejects.toThrow(
        'Invalid classification response format: Response must be a valid object',
      );
    });

    it('should throw error for missing subject_id', async () => {
      const mockResponse = {
        topic_id: 5,
        category_id: 10,
      };

      await expect((service as any).validateAndTransformResponse(mockResponse)).rejects.toThrow(
        'Invalid classification response format: Validation failed:',
      );
    });

    it('should throw error for invalid subject_id (zero)', async () => {
      const mockResponse = {
        subject_id: 0,
        topic_id: 5,
        category_id: 10,
      };

      await expect((service as any).validateAndTransformResponse(mockResponse)).rejects.toThrow(
        'Invalid classification response format: Subject ID must be a positive integer',
      );
    });

    it('should throw error for invalid subject_id (negative)', async () => {
      const mockResponse = {
        subject_id: -1,
        topic_id: 5,
        category_id: 10,
      };

      await expect((service as any).validateAndTransformResponse(mockResponse)).rejects.toThrow(
        'Invalid classification response format: Subject ID must be a positive integer',
      );
    });

    it('should throw error for invalid topic_id (negative)', async () => {
      const mockResponse = {
        subject_id: 1,
        topic_id: -1,
        category_id: 10,
      };

      await expect((service as any).validateAndTransformResponse(mockResponse)).rejects.toThrow(
        'Invalid classification response format: Topic ID must be null or a positive integer',
      );
    });

    it('should throw error for invalid category_id (negative)', async () => {
      const mockResponse = {
        subject_id: 1,
        topic_id: 5,
        category_id: -1,
      };

      await expect((service as any).validateAndTransformResponse(mockResponse)).rejects.toThrow(
        'Invalid classification response format: Category ID must be null or a positive integer',
      );
    });

    it('should accept null values for topic_id and category_id', async () => {
      const mockResponse = {
        subject_id: 1,
        topic_id: null,
        category_id: null,
      };

      const result = await (service as any).validateAndTransformResponse(mockResponse);

      expect(result).toEqual({
        subject_id: 1,
        topic_id: null,
        category_id: null,
      });
    });

    it('should handle class-validator validation errors', async () => {
      const mockResponse = {
        subject_id: 'invalid',  // string instead of number
        topic_id: 5,
        category_id: 10,
      };

      await expect((service as any).validateAndTransformResponse(mockResponse)).rejects.toThrow(
        'Invalid classification response format: Validation failed:',
      );
    });

    it('should handle mixed valid and invalid values', async () => {
      const mockResponse = {
        subject_id: 1,
        topic_id: 'invalid',  // string instead of number
        category_id: 0,  // will be transformed to null
      };

      await expect((service as any).validateAndTransformResponse(mockResponse)).rejects.toThrow(
        'Invalid classification response format: Validation failed:',
      );
    });
  });

  describe('classifyQuestion', () => {
    const mockQuestion = {
      question: 'What is 2 + 2?',
      options: ['3', '4', '5', '6'],
    };

    it('should handle Gemini API errors gracefully', async () => {
      await expect(service.classifyQuestion(mockQuestion)).rejects.toThrow(
        'Failed to classify question:',
      );
    });
  });
}); 