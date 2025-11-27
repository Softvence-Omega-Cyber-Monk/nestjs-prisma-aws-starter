import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('App')
@Controller()
export class AppController {
  @Get()
  @ApiOperation({
    summary: 'Root endpoint',
    description: 'Returns a welcome message and API docs path.',
  })
  @ApiResponse({ status: 200, description: 'API root info.' })
  root() {
    return {
      message: 'Welcome to the API 🚀',
      docs: '/api/docs',
    };
  }

  @Get('health')
  @ApiOperation({
    summary: 'Health check',
    description: 'Returns API health status and timestamp.',
  })
  @ApiResponse({ status: 200, description: 'API is healthy.' })
  health() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
