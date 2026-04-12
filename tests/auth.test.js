const request = require('supertest');
const app = require('../app');
const User = require('../models/User');
const mongoose = require('mongoose');

describe('Auth', () => {
  afterAll(async () => {
    await User.deleteMany();
    await mongoose.disconnect();
  });

  test('Register a new user', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'test@example.com', password: 'password', fullName: 'Test User' });
    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('user');
    expect(res.body.user).toHaveProperty('id');
    expect(res.body.user.email).toBe('test@example.com');
    expect(res.body.user.fullName).toBe('Test User');
    expect(res.body.user.role).toBe('user');
  });

  test('Verify email', async () => {
    const user = await User.findOne({ email: 'test@example.com' });
    const res = await request(app)
      .post('/api/auth/verify-email')
      .send({ email: 'test@example.com', token: user.emailVerificationToken });
    expect(res.statusCode).toBe(200);
    expect(res.body.msg).toBe('Email verified successfully');
  });

  test('Verify phone', async () => {
    const user = await User.findOneAndUpdate(
      { email: 'test@example.com' },
      { phone: '1234567890', phoneVerificationToken: '123456' },
      { new: true }
    );
    const res = await request(app)
      .post('/api/auth/verify-phone')
      .send({ phone: '1234567890', token: '123456' });
    expect(res.statusCode).toBe(200);
    expect(res.body.msg).toBe('Phone verified successfully');
  });

  test('Login with email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'password' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('token');
  });

  test('Login with phone', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ phone: '1234567890', password: 'password' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('token');
  });

  test('Login with invalid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'wrongpassword' });
    expect(res.statusCode).toBe(400);
    expect(res.body.msg).toBe('Invalid credentials');
  });

  test('Login with unverified email', async () => {
    await User.findOneAndUpdate({ email: 'test@example.com' }, { emailVerified: false });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'password' });
    expect(res.statusCode).toBe(400);
    expect(res.body.msg).toBe('Please verify your email first');
  });

  test('Login with unverified phone', async () => {
    await User.findOneAndUpdate({ phone: '1234567890' }, { phoneVerified: false, emailVerified: true });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ phone: '1234567890', password: 'password' });
    expect(res.statusCode).toBe(400);
    expect(res.body.msg).toBe('Please verify your phone first');
  });
});
