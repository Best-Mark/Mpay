import { Module } from '@nestjs/common';
import { ChannelService } from './channel.service';
import { LegalEntityService } from './legal-entity.service';

@Module({
  providers: [ChannelService, LegalEntityService],
  exports: [ChannelService, LegalEntityService],
})
export class ChannelModule {}
