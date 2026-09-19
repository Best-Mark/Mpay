import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InstallService } from './install.service';

/**
 * 首次安装向导接口（未安装时全局唯一可用的一组接口）
 * 安装完成后由 main.ts 的中间件关闭其它接口，本组接口在写入安装标记后自动拒绝写操作
 */
@ApiTags('安装向导')
@Controller('api/install')
export class InstallController {
  constructor(private readonly install: InstallService) {}

  @Get('status')
  @ApiOperation({ summary: '安装状态与环境自检' })
  status() {
    return this.install.status();
  }

  @Post('test-db')
  @ApiOperation({ summary: '测试数据库连接并探测建库权限' })
  testDb(@Body() body: any) {
    return this.install.testDb({
      host: body?.host,
      port: Number(body?.port) || 3306,
      user: body?.user,
      password: body?.password || '',
      database: body?.database,
    });
  }

  @Post('apply')
  @ApiOperation({ summary: '执行安装：写配置 → 建库建表 → 创建超管' })
  apply(@Body() body: any) {
    return this.install.apply({
      db: {
        host: body?.db?.host,
        port: Number(body?.db?.port) || 3306,
        user: body?.db?.user,
        password: body?.db?.password || '',
        database: body?.db?.database,
      },
      redis: {
        enabled: !!body?.redis?.enabled,
        host: body?.redis?.host || '127.0.0.1',
        port: Number(body?.redis?.port) || 6379,
        password: body?.redis?.password || '',
      },
      site: {
        payBaseUrl: body?.site?.payBaseUrl || '',
        masterKey: body?.site?.masterKey || '',
        channelMode: body?.site?.channelMode === 'prod' ? 'prod' : 'sandbox',
      },
      admin: {
        username: body?.admin?.username,
        password: body?.admin?.password,
        nickname: body?.admin?.nickname,
      },
    });
  }

  @Post('restart')
  @ApiOperation({ summary: '安装完成后重启进程以加载新配置' })
  restart(@Body() body: any) {
    return this.install.restart(body?.token);
  }
}
