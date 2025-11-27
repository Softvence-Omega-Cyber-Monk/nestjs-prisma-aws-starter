import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AxiosError } from 'axios';
import { Prisma } from 'generated/client';
import { AppError } from './handle-error.app';

export function simplifyError(
  error: Error,
  customMessage = 'Operation Failed',
  record = 'Record',
): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2000':
        throw new BadRequestException(`${record} field value too long`);
      case 'P2001':
        throw new NotFoundException(`${record} does not exist`);
      case 'P2002':
        throw new ConflictException(`${record} already exists`);
      case 'P2003':
        throw new ConflictException(
          `Foreign key constraint failed on ${record}`,
        );
      case 'P2004':
        throw new BadRequestException(`Constraint failed on ${record}`);
      case 'P2005':
        throw new BadRequestException(
          `Invalid value provided for ${record} field`,
        );
      case 'P2006':
        throw new BadRequestException(
          `Invalid data provided for ${record} field`,
        );
      case 'P2007':
        throw new BadRequestException(`Data validation error on ${record}`);
      case 'P2008':
        throw new InternalServerErrorException(`Failed query parsing`);
      case 'P2009':
        throw new InternalServerErrorException(`Failed query validation`);
      case 'P2010':
        throw new BadRequestException(`Raw query failed`);
      case 'P2011':
        throw new BadRequestException(`Null constraint violation on ${record}`);
      case 'P2012':
        throw new BadRequestException(`${record} missing required value`);
      case 'P2013':
        throw new BadRequestException(
          `Missing required argument for ${record}`,
        );
      case 'P2014':
        throw new ConflictException(
          `Invalid relation: ${record} has conflicting records`,
        );
      case 'P2015':
        throw new NotFoundException(`Related ${record} not found`);
      case 'P2016':
        throw new BadRequestException(`Query interpretation error`);
      case 'P2017':
        throw new ConflictException(`Relation record not found for ${record}`);
      case 'P2018':
        throw new NotFoundException(`Required connected records not found`);
      case 'P2019':
        throw new BadRequestException(`Input error`);
      case 'P2020':
        throw new BadRequestException(`Value out of range for ${record}`);
      case 'P2021':
        throw new NotFoundException(`Table ${record} not found`);
      case 'P2022':
        throw new NotFoundException(`Column for ${record} not found`);
      case 'P2023':
        throw new InternalServerErrorException(`Inconsistent column data`);
      case 'P2024':
        throw new InternalServerErrorException(`Timed out fetching ${record}`);
      case 'P2025':
        throw new NotFoundException(`${record} not found`);
      case 'P2026':
        throw new InternalServerErrorException(`Unsupported feature requested`);
      case 'P2027':
        throw new InternalServerErrorException(
          `Multiple errors occurred during query`,
        );
      case 'P2028':
        throw new InternalServerErrorException(`Transaction API error`);
      case 'P2030':
        throw new InternalServerErrorException(
          `Database schema is out of date`,
        );
      case 'P2033':
        throw new BadRequestException(`Number out of range for ${record}`);
      case 'P2034':
        throw new ForbiddenException(`Transaction was aborted`);
      default:
        throw new InternalServerErrorException(
          `Database error: ${error.message}`,
        );
    }
  }

  if (error instanceof AppError) {
    switch (error.code) {
      case 400:
        throw new BadRequestException(error.message);
      case 401:
        throw new UnauthorizedException(error.message);
      case 403:
        throw new ForbiddenException(error.message);
      case 404:
        throw new NotFoundException(error.message);
      case 409:
        throw new ConflictException(error.message);
      default:
        throw new InternalServerErrorException(error.message);
    }
  }

  if (error instanceof AxiosError) {
    const status = error.response?.status || 500;
    const message =
      error.response?.data?.message ||
      error.response?.data?.error ||
      error.message ||
      'Axios request failed';

    switch (status) {
      case 400:
        throw new BadRequestException(message);
      case 401:
        throw new UnauthorizedException(message);
      case 403:
        throw new ForbiddenException(message);
      case 404:
        throw new NotFoundException(message);
      case 409:
        throw new ConflictException(message);
      case 422:
        throw new UnprocessableEntityException(message);
      default:
        throw new InternalServerErrorException(message);
    }
  }

  throw new InternalServerErrorException(error.message || customMessage);
}
