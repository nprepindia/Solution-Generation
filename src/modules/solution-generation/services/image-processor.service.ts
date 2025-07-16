import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { ExtractedImage } from '../dto/servicable-question.dto';

@Injectable()
export class ImageProcessorService {
  private readonly logger = new Logger(ImageProcessorService.name);

  /**
   * Extract image URLs from markdown text and convert them to base64
   * @param markdownText - Text that may contain markdown images
   * @returns Promise<ExtractedImage[]> - Array of processed images
   */
  async extractAndProcessImages(markdownText: string): Promise<ExtractedImage[]> {
    try {
      // Regex pattern to match markdown images: ![alt text](url)
      const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
      const extractedImages: ExtractedImage[] = [];
      let match;

      this.logger.log(`🔍 DEBUG - Processing markdown text for images: ${markdownText.substring(0, 200)}...`);

      while ((match = imageRegex.exec(markdownText)) !== null) {
        const altText = match[1] || '';
        const imageUrl = match[2];

        this.logger.log(`🖼️ Found image: ${imageUrl} with alt text: "${altText}"`);
        this.logger.log(`🔍 DEBUG - Full match: "${match[0]}"`);

        try {
          this.logger.log(`🔍 DEBUG - Starting download for: ${imageUrl}`);
          const processedImage = await this.downloadAndConvertToBase64(imageUrl, altText);
          extractedImages.push(processedImage);
          this.logger.log(`✅ Successfully processed image: ${imageUrl}`);
        } catch (error) {
          this.logger.error(`❌ Failed to process image ${imageUrl}: ${error.message}`);
          this.logger.error(`🔍 DEBUG - Error details:`, error);
          // Continue processing other images even if one fails
        }
      }

      this.logger.log(`✅ Successfully processed ${extractedImages.length} images out of total found`);
      return extractedImages;
    } catch (error) {
      this.logger.error(`❌ Error extracting images from markdown: ${error.message}`);
      this.logger.error(`🔍 DEBUG - Full error:`, error);
      return [];
    }
  }

  /**
   * Download image from URL and convert to base64
   * @param imageUrl - URL of the image to download
   * @param altText - Alt text from markdown
   * @returns Promise<ExtractedImage> - Processed image data
   */
  private async downloadAndConvertToBase64(imageUrl: string, altText?: string): Promise<ExtractedImage> {
    try {
      this.logger.log(`🔍 DEBUG - Starting download from: ${imageUrl}`);
      this.logger.log(`🔍 DEBUG - Using timeout: 30000ms`);

      // Download the image
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 30000, // 30 second timeout
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });

      this.logger.log(`🔍 DEBUG - Download response: status=${response.status}, content-type=${response.headers['content-type']}, data length=${response.data.byteLength}`);

      // Convert to base64
      const base64Data = Buffer.from(response.data, 'binary').toString('base64');
      this.logger.log(`🔍 DEBUG - Converted to base64, length: ${base64Data.length} characters`);

      // Determine MIME type from response headers or URL extension
      const mimeType = this.determineMimeType(response.headers['content-type'], imageUrl);
      this.logger.log(`🔍 DEBUG - Determined MIME type: ${mimeType}`);

      // Validate that it's a supported image format
      if (!this.isSupportedImageFormat(mimeType)) {
        throw new Error(`Unsupported image format: ${mimeType}`);
      }

      this.logger.log(`✅ Successfully converted image to base64. Size: ${base64Data.length} characters, MIME: ${mimeType}`);

      const result = {
        mimeType,
        data: base64Data,
        originalUrl: imageUrl,
        altText
      };

      this.logger.log(`🔍 DEBUG - Final image object keys: ${Object.keys(result)}`);
      this.logger.log(`🔍 DEBUG - Data preview: ${base64Data.substring(0, 100)}...`);

      return result;
    } catch (error) {
      this.logger.error(`❌ Failed to download and convert image ${imageUrl}: ${error.message}`);
      this.logger.error(`🔍 DEBUG - Error type: ${error.constructor.name}`);
      this.logger.error(`🔍 DEBUG - Error details:`, error);
      throw error;
    }
  }

  /**
   * Determine MIME type from content-type header or file extension
   * @param contentType - Content-Type header from response
   * @param imageUrl - Original image URL
   * @returns string - MIME type
   */
  private determineMimeType(contentType: string, imageUrl: string): string {
    // First try to get from content-type header
    if (contentType && contentType.startsWith('image/')) {
      return contentType.split(';')[0]; // Remove any charset info
    }

    // Fallback to file extension
    const urlLower = imageUrl.toLowerCase();
    if (urlLower.endsWith('.png')) return 'image/png';
    if (urlLower.endsWith('.jpg') || urlLower.endsWith('.jpeg')) return 'image/jpeg';
    if (urlLower.endsWith('.webp')) return 'image/webp';
    if (urlLower.endsWith('.heic')) return 'image/heic';
    if (urlLower.endsWith('.heif')) return 'image/heif';

    // Default to JPEG if we can't determine
    this.logger.warn(`Could not determine MIME type for ${imageUrl}, defaulting to image/jpeg`);
    return 'image/jpeg';
  }

  /**
   * Check if the MIME type is supported by Gemini
   * Based on: https://ai.google.dev/gemini-api/docs/image-understanding
   * @param mimeType - MIME type to validate
   * @returns boolean - Whether the format is supported
   */
  private isSupportedImageFormat(mimeType: string): boolean {
    const supportedFormats = [
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/heic',
      'image/heif'
    ];
    return supportedFormats.includes(mimeType);
  }

  /**
   * Remove markdown image syntax from text, leaving clean text
   * @param markdownText - Text containing markdown images
   * @returns string - Text with image markdown removed
   */
  removeImageMarkdown(markdownText: string): string {
    // Remove markdown images: ![alt text](url)
    return markdownText.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '').trim();
  }

  /**
   * Process both question and options to extract images and clean text
   * @param question - Question text that may contain images
   * @param options - Array of option texts that may contain images
   * @returns Promise<{question: string, options: string[], images: ExtractedImage[]}>
   */
  async processQuestionAndOptions(question: string, options: string[]): Promise<{
    question: string;
    options: string[];
    images: ExtractedImage[];
  }> {
    this.logger.log('🔍 DEBUG - Starting processQuestionAndOptions');
    this.logger.log(`🔍 DEBUG - Input question: ${question}`);
    this.logger.log(`🔍 DEBUG - Input options: ${JSON.stringify(options, null, 2)}`);

    // Combine all text to extract images from
    const allText = [question, ...options].join('\n');
    this.logger.log(`🔍 DEBUG - Combined text for image extraction: ${allText}`);
    
    // Extract and process all images
    this.logger.log(`🔍 DEBUG - Calling extractAndProcessImages...`);
    const images = await this.extractAndProcessImages(allText);
    this.logger.log(`🔍 DEBUG - extractAndProcessImages returned ${images.length} images`);

    // Clean the text by removing image markdown
    const cleanQuestion = this.removeImageMarkdown(question);
    const cleanOptions = options.map(option => this.removeImageMarkdown(option));

    this.logger.log(`🔍 DEBUG - Cleaned question: ${cleanQuestion}`);
    this.logger.log(`🔍 DEBUG - Cleaned options: ${JSON.stringify(cleanOptions, null, 2)}`);

    this.logger.log(`✅ Processed question and options. Found ${images.length} images.`);
    
    const result = {
      question: cleanQuestion,
      options: cleanOptions,
      images
    };

    this.logger.log(`🔍 DEBUG - Final result keys: ${Object.keys(result)}`);
    
    return result;
  }
} 