import { Module } from '@nestjs/common';
import { PublishService } from './publish.service';
import { PublishTasksController } from './publish-tasks.controller';
import { DeployController } from './deploy.controller';
import { DocusaurusController } from './docusaurus.controller';
import { TaskLogsController } from './task-logs.controller';
import { HelpCenterController } from './help-center.controller';
import { GitController } from './git.controller';
import { PreviewController } from './preview.controller';
import { SystemConfigModule } from '../system-config/system-config.module';

@Module({
  imports: [SystemConfigModule],
  controllers: [
    PublishTasksController,
    DeployController,
    DocusaurusController,
    TaskLogsController,
    HelpCenterController,
    GitController,
    PreviewController,
  ],
  providers: [PublishService],
})
export class PublishModule {}
