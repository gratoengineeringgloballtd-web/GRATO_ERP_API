# MTN Mobile Money Payment Flow Documentation

## Overview
This document describes the payment flow implementation for MTN Mobile Money in the task management application.

## Environment Variables Required
```
MTN_MOMO_API_URL=https://sandbox.momodeveloper.mtn.com
MTN_MOMO_PRIMARY_KEY=your_primary_key
MTN_MOMO_SECONDARY_KEY=your_secondary_key
MTN_MOMO_API_USER=your_api_user
MTN_MOMO_API_KEY=your_api_key
MTN_MOMO_ENVIRONMENT=sandbox
```

## API Endpoints

### 1. Initiate Payment
- **Endpoint:** POST /api/payments/initiate
- **Authentication:** Required
- **Request Body:**
  ```json
  {
    "taskId": "task_id_here",
    "phoneNumber": "237xxxxxxxxx"
  }
  ```
- **Response:**
  ```json
  {
    "message": "Payment initiated successfully",
    "paymentId": "payment_id_here",
    "transactionId": "transaction_id_here"
  }
  ```

### 2. Check Payment Status
- **Endpoint:** GET /api/payments/status/:paymentId
- **Authentication:** Required
- **Response:**
  ```json
  {
    "status": "completed",
    "paymentId": "payment_id_here",
    "transactionId": "transaction_id_here"
  }
  ```

### 3. Get Payment History
- **Endpoint:** GET /api/payments/history
- **Authentication:** Required
- **Response:** Array of payment objects

## Payment Flow

1. **Task Creation:**
   - Task is created with a budget amount
   - Initial payment status is 'unpaid'

2. **Payment Initiation:**
   - User initiates payment for a task
   - System creates a payment record
   - MTN Mobile Money payment request is initiated
   - Payment status changes to 'pending'

3. **Payment Processing:**
   - User receives prompt on their phone to approve payment
   - System periodically checks payment status
   - When payment completes:
     - Payment status updates to 'completed'
     - Task payment status updates to 'paid'

4. **Error Handling:**
   - Failed payments are marked with 'failed' status
   - System provides appropriate error messages
   - Users can retry failed payments

## Security Measures

1. All payment endpoints require authentication
2. Phone number validation for Cameroon numbers
3. Secure storage of MTN MoMo credentials in environment variables
4. Transaction IDs are unique and tracked
5. Payment history is tied to user accounts