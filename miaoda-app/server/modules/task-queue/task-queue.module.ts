import { Module } from '@nestjs/common';
import { TaskQueueService } from './task-queue.service';
import { TaskQueueController } from './task-queue.controller';

@Module({
  controllers: [TaskQueueController],
  providers: [TaskQueueService],
  exports: [TaskQueueService],
})
export class TaskQueueModule {}
