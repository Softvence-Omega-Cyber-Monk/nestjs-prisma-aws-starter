import { User } from '@prisma';

export interface GenericPayload {
  adminId: string;
  message: string;
  admin: User;
}
