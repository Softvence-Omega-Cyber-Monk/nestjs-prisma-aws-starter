import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

@Injectable()
export class ParseJsonPipe implements PipeTransform {
  transform(value: any) {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch (err) {
        console.error(err);
        throw new BadRequestException('Invalid JSON string');
      }
    }
    return value;
  }
}
