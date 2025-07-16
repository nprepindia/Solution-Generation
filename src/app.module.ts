import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SolutionGenerationModule } from './modules/solution-generation.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Makes ConfigModule available globally without importing in each module
      envFilePath: '.env', // Path to .env file
      expandVariables: true, // Allow variable expansion in .env file
    }),
    SolutionGenerationModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
