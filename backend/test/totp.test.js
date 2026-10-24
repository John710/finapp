import { describe, it, expect } from 'vitest'
import { OTP, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib'

// Pins the otplib v13 API shape used by routes/auth.js — a regression here
// crashes the whole server on boot (learned the hard way via CI).
const otpCrypto = new NobleCryptoPlugin()
const otpBase32 = new ScureBase32Plugin()

describe('otplib v13 TOTP flow', () => {
  it('generates a base32 secret', () => {
    const otp = new OTP({ crypto: otpCrypto, base32: otpBase32 })
    const secret = otp.generateSecret()
    expect(secret).toMatch(/^[A-Z2-7]+=*$/)
    expect(secret.length >= 16).toBe(true)
  })

  it('verify({secret, token}) returns a VerifyResult with valid flag', async () => {
    const otp = new OTP({ crypto: otpCrypto, base32: otpBase32 })
    const secret = otp.generateSecret()
    const token = await otp.generate({ secret })
    const result = await otp.verify({ secret, token })
    expect(result.valid).toBe(true)
  })

  it('rejects a wrong token', async () => {
    const otp = new OTP({ crypto: otpCrypto, base32: otpBase32 })
    const secret = otp.generateSecret()
    const result = await otp.verify({ secret, token: '000000' })
    expect(result.valid).toBe(false)
  })

  it('generateURI produces an otpauth://totp URL with the issuer', () => {
    const otp = new OTP({ crypto: otpCrypto, base32: otpBase32 })
    const secret = otp.generateSecret()
    const uri = otp.generateURI({ issuer: 'FinApp', label: 'john', secret })
    expect(uri.startsWith('otpauth://totp/')).toBe(true)
    expect(uri.includes('issuer=FinApp')).toBe(true)
    expect(uri.includes('secret=')).toBe(true)
  })
})
