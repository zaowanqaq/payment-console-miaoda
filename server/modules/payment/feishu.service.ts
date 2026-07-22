import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { PaymentConfig } from './payment.config';
import type { OAuthToken } from './payment.types';

type FeishuEnvelope<T> = { code?: number; msg?: string; data?: T } & T;

@Injectable()
export class FeishuService {
  private readonly tokenCookie = 'payment_feishu_token';
  private readonly stateCookie = 'payment_oauth_state';
  private readonly key: Buffer;
  private tenantToken?: { value: string; expiresAt: number };

  constructor(private readonly config: PaymentConfig) {
    this.key = createHash('sha256').update(config.sessionSecret).digest();
  }

  private cookies(req: Request): Record<string, string> {
    return Object.fromEntries((req.headers.cookie || '').split(';').map((item) => {
      const index = item.indexOf('=');
      return index < 0 ? ['', ''] : [item.slice(0, index).trim(), decodeURIComponent(item.slice(index + 1))];
    }).filter(([key]) => key));
  }

  private seal(value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
  }

  private unseal<T>(value?: string): T | null {
    if (!value) return null;
    try {
      const [iv, tag, encrypted] = value.split('.').map((part) => Buffer.from(part, 'base64url'));
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')) as T;
    } catch {
      return null;
    }
  }

  private cookieOptions(maxAge: number) {
    return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge };
  }

  private redirectUri(req: Request): string {
    if (this.config.oauthRedirectUri) return this.config.oauthRedirectUri;
    const protocol = req.headers['x-forwarded-proto']?.toString().split(',')[0] || req.protocol;
    const host = req.headers['x-forwarded-host']?.toString().split(',')[0] || req.get('host');
    return `${protocol}://${host}/api/oauth/callback`;
  }

  createAuthorizeUrl(req: Request, res: Response): string {
    const nonce = randomBytes(24).toString('base64url');
    res.cookie(this.stateCookie, this.seal({ nonce, createdAt: Date.now() }), this.cookieOptions(10 * 60 * 1000));
    const query = new URLSearchParams({
      app_id: this.config.appId,
      redirect_uri: this.redirectUri(req),
      scope: this.config.oauthScopes,
      state: nonce,
    });
    return `https://accounts.feishu.cn/open-apis/authen/v1/authorize?${query}`;
  }

  async completeOAuth(req: Request, res: Response, code: string, state: string): Promise<void> {
    const saved = this.unseal<{ nonce: string; createdAt: number }>(this.cookies(req)[this.stateCookie]);
    const stateBytes = Buffer.from(state || '');
    const nonceBytes = Buffer.from(saved?.nonce || '');
    if (!saved || stateBytes.length !== nonceBytes.length || !timingSafeEqual(stateBytes, nonceBytes) || Date.now() - saved.createdAt > 10 * 60 * 1000) {
      throw new HttpException('飞书授权状态已失效，请返回插件重新授权', HttpStatus.BAD_REQUEST);
    }
    const response = await fetch('https://open.feishu.cn/open-apis/authen/v2/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: this.config.appId,
        client_secret: this.config.appSecret,
        code,
        redirect_uri: this.redirectUri(req),
      }),
    });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok || payload.code) throw new HttpException(String(payload.error_description || payload.msg || '飞书授权失败'), HttpStatus.BAD_GATEWAY);
    this.writeToken(res, this.toToken(payload));
    res.clearCookie(this.stateCookie, { path: '/' });
  }

  private toToken(payload: Record<string, unknown>): OAuthToken {
    const now = Date.now();
    return {
      accessToken: String(payload.access_token || ''),
      refreshToken: String(payload.refresh_token || ''),
      expiresAt: now + Number(payload.expires_in || 0) * 1000,
      refreshExpiresAt: now + Number(payload.refresh_token_expires_in || 0) * 1000,
    };
  }

  private writeToken(res: Response, token: OAuthToken) {
    const maxAge = Math.max(60_000, token.refreshExpiresAt - Date.now());
    res.cookie(this.tokenCookie, this.seal(token), this.cookieOptions(maxAge));
  }

  async userToken(req: Request, res: Response, required = true): Promise<string | null> {
    let token = this.unseal<OAuthToken>(this.cookies(req)[this.tokenCookie]);
    if (!token || token.refreshExpiresAt <= Date.now()) {
      if (required) throw new HttpException('请先授权飞书身份', HttpStatus.UNAUTHORIZED);
      return null;
    }
    if (token.expiresAt <= Date.now() + 60_000) {
      const response = await fetch('https://open.feishu.cn/open-apis/authen/v2/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          client_id: this.config.appId,
          client_secret: this.config.appSecret,
          refresh_token: token.refreshToken,
        }),
      });
      const payload = await response.json() as Record<string, unknown>;
      if (!response.ok || payload.code) {
        res.clearCookie(this.tokenCookie, { path: '/' });
        if (required) throw new HttpException('飞书授权已过期，请重新授权', HttpStatus.UNAUTHORIZED);
        return null;
      }
      token = this.toToken(payload);
      this.writeToken(res, token);
    }
    return token.accessToken;
  }

  async tenantAccessToken(): Promise<string> {
    if (this.tenantToken && this.tenantToken.expiresAt > Date.now() + 60_000) return this.tenantToken.value;
    const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: this.config.appId, app_secret: this.config.appSecret }),
    });
    const payload = await response.json() as { code?: number; msg?: string; tenant_access_token?: string; expire?: number };
    if (!response.ok || payload.code || !payload.tenant_access_token) throw new Error(payload.msg || '获取应用访问凭证失败');
    this.tenantToken = { value: payload.tenant_access_token, expiresAt: Date.now() + Number(payload.expire || 7200) * 1000 };
    return this.tenantToken.value;
  }

  async api<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`https://open.feishu.cn/open-apis/${path.replace(/^\//, '')}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    });
    const payload = await response.json() as FeishuEnvelope<T>;
    if (!response.ok || (typeof payload.code === 'number' && payload.code !== 0)) {
      throw new Error(payload.msg || `飞书接口请求失败（${response.status}）`);
    }
    return (payload.data ?? payload) as T;
  }

  async download(urlPath: string, token: string): Promise<{ buffer: Buffer; contentType: string }> {
    const response = await fetch(`https://open.feishu.cn/open-apis/${urlPath.replace(/^\//, '')}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`附件下载失败（${response.status}）`);
    return { buffer: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') || 'application/octet-stream' };
  }
}
