import { Module } from '@nestjs/common';
import { InstallService } from './install.service';
import { InstallController } from './install.controller';

@Module({
  providers: [InstallService],
  controllers: [InstallController],
  exports: [InstallService],
})
export class InstallModule {}
