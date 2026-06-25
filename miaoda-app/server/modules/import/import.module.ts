import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { FeishuMappingsController } from './feishu-mappings.controller';
import { FeishuMappingsService } from './feishu-mappings.service';
import { FeishuService } from './feishu.service';
import { CategoriesModule } from '@server/modules/categories/categories.module';
import { DocumentsModule } from '@server/modules/documents/documents.module';
import { SystemConfigModule } from '@server/modules/system-config/system-config.module';

@Module({
  imports: [CategoriesModule, DocumentsModule, SystemConfigModule],
  controllers: [ImportController, FeishuMappingsController],
  providers: [ImportService, FeishuMappingsService, FeishuService],
})
export class ImportModule {}
