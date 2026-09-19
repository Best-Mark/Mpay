import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InstallService, verifyInstallToken } from './install.service';

/**
 * 首次安装向导接口（未安装时全局唯一可用的一组接口）
 * 安装完成后由 main.ts 的中间件关闭其它接口，本组接口在写入安装标记后自动拒绝写操作
 * 安全：若部署时设置了环境变量 INSTALL_TOKEN，写操作需携带令牌（header x-install-token 或 body.token）
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
  testDb(@Body() body: any, @Headers('x-install-token') token?: string) {
    verifyInstallToken(token || body?.token);
    return this.install.testDb({
      host: body?.host,
      port: Number(body?.port) || 3306,
      user: body?.user,
      password: body?.password || '',
      database: body?.database,
    });
  }

  @Post('check-port')
  @ApiOperation({ summary: '检测服务端口是否被占用' })
  checkPort(@Body() body: any, @Headers('x-install-token') token?: string) {
    verifyInstallToken(token || body?.token);
    return this.install.checkPort(Number(body?.port));
  }

  @Post('check-url')
  @ApiOperation({ summary: '检测对外访问地址是否可达（仅允许公网地址）' })
  checkUrl(@Body() body: any, @Headers('x-install-token') token?: string) {
    verifyInstallToken(token || body?.token);
    return this.install.checkUrl(body?.url);
  }

  @Post('apply')
  @ApiOperation({ summary: '执行安装：写配置 → 建库建表 → 创建超管' })
  apply(@Body() body: any, @Headers('x-install-token') token?: string) {
    verifyInstallToken(token || body?.token);
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
        port: Number(body?.site?.port) || undefined,
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
  restart(@Body() body: any, @Headers('x-install-token') installToken?: string) {
    // 两种 token 各司其职：body.token=安装令牌，body.restartToken=安装成功后下发的一次性重启凭证
    verifyInstallToken(installToken || body?.token);
    return this.install.restart(body?.restartToken);
  }
}
