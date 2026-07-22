import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { FeishuService } from './feishu.service';
import { PaymentService } from './payment.service';

@Controller('api')
export class PaymentController {
  constructor(private readonly feishu: FeishuService, private readonly payment: PaymentService) {}

  @Get('health')
  health() {
    return { ok: true };
  }

  @Get('auth/me')
  @NeedLogin()
  async me(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = await this.feishu.userToken(req, res, false);
    if (!token) {
      return { name: req.userContext?.userName || '当前用户', openId: '', authMode: 'oauth', verified: false, authorized: false, authorizeUrl: this.feishu.createAuthorizeUrl(req) };
    }
    try {
      const user = await this.feishu.api<{ name?: string; open_id?: string }>('authen/v1/user_info', token);
      return { name: user.name || '飞书用户', openId: user.open_id || '', authMode: 'oauth', verified: true, authorized: true };
    } catch {
      return { name: req.userContext?.userName || '当前用户', openId: '', authMode: 'oauth', verified: false, authorized: false, authorizeUrl: this.feishu.createAuthorizeUrl(req) };
    }
  }

  @Post('oauth/callback')
  async callback(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: { code?: string; state?: string }) {
    const session = await this.feishu.completeOAuth(req, res, body.code || '', body.state || '');
    return { ok: true, session };
  }

  @Get('batches/preview')
  @NeedLogin()
  preview(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Query('tableId') tableId?: string) {
    return this.payment.preview(req, res, tableId);
  }

  @Post('batches/submit')
  @NeedLogin()
  submit(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: { reason?: string; paymentEntity?: string; expectedPaymentDate?: string; confirmed?: boolean }) {
    return this.payment.submit(req, res, body);
  }

  @Post('approvals/sync')
  @NeedLogin()
  sync(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: { confirmed?: boolean }) {
    return this.payment.sync(req, res, body?.confirmed === true);
  }
}
