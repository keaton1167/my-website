import { APP_FILTER } from '@nestjs/core';
import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { PlatformModule } from '@lark-apaas/fullstack-nestjs-core';

import { GlobalExceptionFilter } from './common/filters/exception.filter';
import { ViewModule } from './modules/view/view.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { ImportModule } from './modules/import/import.module';
import { PublishModule } from './modules/publish/publish.module';
import { SystemConfigModule } from './modules/system-config/system-config.module';
import { TaskQueueModule } from './modules/task-queue/task-queue.module';

@Module({
  imports: [
    // 平台 Module，提供平台能力
    PlatformModule.forRoot(),
    // ====== @route-section: business-modules START ======
    DashboardModule,
    DocumentsModule,
    CategoriesModule,
    ImportModule,
    PublishModule,
    SystemConfigModule,
    TaskQueueModule,
    // ====== @route-section: business-modules END ======

    // ⚠️ @route-order: last
    // ViewModule is the fallback route module, must be registered last.
    ViewModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule implements OnModuleInit {
  private readonly logger = new Logger(AppModule.name);

  onModuleInit() {
    process.on('unhandledRejection', (reason: unknown) => {
      this.logger.error(`Unhandled rejection caught: ${JSON.stringify(reason)}`);
    });
    process.on('uncaughtException', (err: Error) => {
      this.logger.error(`Uncaught exception caught: ${err.message}`);
    });
  }
}
