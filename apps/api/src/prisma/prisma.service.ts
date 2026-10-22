import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { asWriteConflict, prismaAdapter } from './client.js';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({ adapter: prismaAdapter() });
    // A conflict at COMMIT comes back as a P2034 like any other (see asWriteConflict).
    const transaction = this.$transaction.bind(this) as (...args: unknown[]) => Promise<unknown>;
    this.$transaction = ((...args: unknown[]) =>
      transaction(...args).catch((e: unknown) => {
        throw asWriteConflict(e);
      })) as PrismaClient['$transaction'];
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
