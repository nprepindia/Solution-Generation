import { Test, TestingModule } from '@nestjs/testing';
import { ImageProcessorService } from './image-processor.service';
import { ExtractedImage } from '../dto/servicable-question.dto';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ImageProcessorService', () => {
  let service: ImageProcessorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ImageProcessorService],
    }).compile();

    service = module.get<ImageProcessorService>(ImageProcessorService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });
  });

  describe('extractAndProcessImages', () => {
    beforeEach(() => {
      // Mock successful image download
      mockedAxios.get.mockResolvedValue({
        data: Buffer.from('fake image data'),
        headers: { 'content-type': 'image/jpeg' },
      });
    });

    it('should extract and process a single image from markdown', async () => {
      const markdownText = 'Here is an image: ![Test Image](https://example.com/test.jpg)';
      const result = await service.extractAndProcessImages(markdownText);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        mimeType: 'image/jpeg',
        originalUrl: 'https://example.com/test.jpg',
        altText: 'Test Image',
        data: expect.any(String),
      });
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://example.com/test.jpg',
        expect.objectContaining({
          responseType: 'arraybuffer',
          timeout: 30000,
        })
      );
    });

    it('should extract and process multiple images from markdown', async () => {
      const markdownText = `
        First image: ![Image 1](https://example.com/image1.png)
        Second image: ![Image 2](https://example.com/image2.jpg)
        Third image: ![](https://example.com/image3.webp)
      `;

      // Mock different content types for different images
      mockedAxios.get
        .mockResolvedValueOnce({
          data: Buffer.from('png data'),
          headers: { 'content-type': 'image/png' },
        })
        .mockResolvedValueOnce({
          data: Buffer.from('jpg data'),
          headers: { 'content-type': 'image/jpeg' },
        })
        .mockResolvedValueOnce({
          data: Buffer.from('webp data'),
          headers: { 'content-type': 'image/webp' },
        });

      const result = await service.extractAndProcessImages(markdownText);

      expect(result).toHaveLength(3);
      expect(result[0].altText).toBe('Image 1');
      expect(result[0].mimeType).toBe('image/png');
      expect(result[1].altText).toBe('Image 2');
      expect(result[1].mimeType).toBe('image/jpeg');
      expect(result[2].altText).toBe('');
      expect(result[2].mimeType).toBe('image/webp');
    });

    it('should handle text without images', async () => {
      const markdownText = 'This is just regular text without any images.';
      const result = await service.extractAndProcessImages(markdownText);

      expect(result).toHaveLength(0);
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('should continue processing other images when one fails', async () => {
      const markdownText = `
        Good image: ![Image 1](https://example.com/good.jpg)
        Bad image: ![Image 2](https://example.com/bad.jpg)
        Another good image: ![Image 3](https://example.com/good2.jpg)
      `;

      mockedAxios.get
        .mockResolvedValueOnce({
          data: Buffer.from('good data'),
          headers: { 'content-type': 'image/jpeg' },
        })
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          data: Buffer.from('good data 2'),
          headers: { 'content-type': 'image/jpeg' },
        });

      const result = await service.extractAndProcessImages(markdownText);

      expect(result).toHaveLength(2);
      expect(result[0].altText).toBe('Image 1');
      expect(result[1].altText).toBe('Image 3');
    });

    it('should handle unsupported image formats', async () => {
      const markdownText = 'Unsupported: ![GIF](https://example.com/animated.gif)';

      mockedAxios.get.mockResolvedValue({
        data: Buffer.from('gif data'),
        headers: { 'content-type': 'image/gif' },
      });

      const result = await service.extractAndProcessImages(markdownText);

      expect(result).toHaveLength(0);
    });

    it('should return empty array on processing errors', async () => {
      const markdownText = 'Image: ![Test](https://example.com/test.jpg)';
      
      // Mock axios to throw an error that causes the entire process to fail
      mockedAxios.get.mockImplementation(() => {
        throw new Error('Network completely down');
      });

      const result = await service.extractAndProcessImages(markdownText);

      expect(result).toHaveLength(0);
    });
  });

  describe('determineMimeType', () => {
    it('should determine MIME type from content-type header', () => {
      const service = new ImageProcessorService();
      // Access private method through type assertion
      const result = (service as any).determineMimeType('image/png; charset=utf-8', 'test.jpg');
      expect(result).toBe('image/png');
    });

    it('should determine MIME type from file extension when header is missing', () => {
      const service = new ImageProcessorService();
      const testCases = [
        ['test.png', 'image/png'],
        ['test.jpg', 'image/jpeg'],
        ['test.jpeg', 'image/jpeg'],
        ['test.webp', 'image/webp'],
        ['test.heic', 'image/heic'],
        ['test.heif', 'image/heif'],
      ];

      testCases.forEach(([url, expectedMime]) => {
        const result = (service as any).determineMimeType('', url);
        expect(result).toBe(expectedMime);
      });
    });

    it('should default to image/jpeg for unknown extensions', () => {
      const service = new ImageProcessorService();
      const result = (service as any).determineMimeType('', 'test.unknown');
      expect(result).toBe('image/jpeg');
    });
  });

  describe('isSupportedImageFormat', () => {
    it('should return true for supported formats', () => {
      const service = new ImageProcessorService();
      const supportedFormats = [
        'image/png',
        'image/jpeg',
        'image/webp',
        'image/heic',
        'image/heif',
      ];

      supportedFormats.forEach(format => {
        const result = (service as any).isSupportedImageFormat(format);
        expect(result).toBe(true);
      });
    });

    it('should return false for unsupported formats', () => {
      const service = new ImageProcessorService();
      const unsupportedFormats = [
        'image/gif',
        'image/svg+xml',
        'image/bmp',
        'image/tiff',
        'application/pdf',
      ];

      unsupportedFormats.forEach(format => {
        const result = (service as any).isSupportedImageFormat(format);
        expect(result).toBe(false);
      });
    });
  });

  describe('removeImageMarkdown', () => {
    it('should remove single image markdown', () => {
      const text = 'Before ![Alt text](https://example.com/image.jpg) After';
      const result = service.removeImageMarkdown(text);
      expect(result).toBe('Before  After');
    });

    it('should remove multiple image markdowns', () => {
      const text = `
        First ![Image 1](url1.jpg) middle
        Second ![Image 2](url2.png) end
      `;
      const result = service.removeImageMarkdown(text);
      expect(result).not.toContain('![');
      expect(result).not.toContain('](');
    });

    it('should handle text without images', () => {
      const text = 'Regular text without any images';
      const result = service.removeImageMarkdown(text);
      expect(result).toBe('Regular text without any images');
    });

    it('should trim whitespace', () => {
      const text = '   ![Image](url.jpg)   ';
      const result = service.removeImageMarkdown(text);
      expect(result).toBe('');
    });
  });

  describe('processQuestionAndOptions', () => {
    beforeEach(() => {
      mockedAxios.get.mockResolvedValue({
        data: Buffer.from('fake image data'),
        headers: { 'content-type': 'image/jpeg' },
      });
    });

    it('should process question and options with images', async () => {
      const question = 'What is shown in this image? ![Question Image](https://example.com/q.jpg)';
      const options = [
        'Option A ![A](https://example.com/a.jpg)',
        'Option B',
        'Option C ![C](https://example.com/c.png)',
        'Option D'
      ];

      const result = await service.processQuestionAndOptions(question, options);

      expect(result.question).toBe('What is shown in this image?');
      expect(result.options).toEqual(['Option A', 'Option B', 'Option C', 'Option D']);
      expect(result.images).toHaveLength(3);
      expect(result.images[0].altText).toBe('Question Image');
      expect(result.images[1].altText).toBe('A');
      expect(result.images[2].altText).toBe('C');
    });

    it('should handle question and options without images', async () => {
      const question = 'Regular question without images';
      const options = ['Option A', 'Option B', 'Option C', 'Option D'];

      const result = await service.processQuestionAndOptions(question, options);

      expect(result.question).toBe(question);
      expect(result.options).toEqual(options);
      expect(result.images).toHaveLength(0);
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('should handle mixed content correctly', async () => {
      const question = 'Mixed question ![img](https://example.com/q.jpg) with text';
      const options = [
        'Option A with image ![A](https://example.com/a.jpg) and more text',
        'Option B without image',
        'Option C ![C](https://example.com/c.png)',
        'Option D'
      ];

      const result = await service.processQuestionAndOptions(question, options);

      expect(result.question).toBe('Mixed question  with text');
      expect(result.options[0]).toBe('Option A with image  and more text');
      expect(result.options[1]).toBe('Option B without image');
      expect(result.options[2]).toBe('Option C');
      expect(result.options[3]).toBe('Option D');
      expect(result.images).toHaveLength(3);
    });
  });

  describe('downloadAndConvertToBase64', () => {
    it('should successfully download and convert image to base64', async () => {
      const imageData = Buffer.from('test image data');
      mockedAxios.get.mockResolvedValue({
        data: imageData,
        headers: { 'content-type': 'image/jpeg' },
      });

      const result = await (service as any).downloadAndConvertToBase64(
        'https://example.com/test.jpg',
        'Test Alt'
      );

      expect(result).toMatchObject({
        mimeType: 'image/jpeg',
        data: imageData.toString('base64'),
        originalUrl: 'https://example.com/test.jpg',
        altText: 'Test Alt',
      });
    });

    it('should handle download timeout', async () => {
      mockedAxios.get.mockRejectedValue(new Error('timeout'));

      await expect(
        (service as any).downloadAndConvertToBase64('https://example.com/test.jpg')
      ).rejects.toThrow();
    });

    it('should validate supported image formats', async () => {
      mockedAxios.get.mockResolvedValue({
        data: Buffer.from('gif data'),
        headers: { 'content-type': 'image/gif' },
      });

      await expect(
        (service as any).downloadAndConvertToBase64('https://example.com/test.gif')
      ).rejects.toThrow('Unsupported image format: image/gif');
    });
  });
}); 