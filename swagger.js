const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.1.0',
    info: {
      title: 'PiknGo API',
      version: '1.0.0',
      description: 'API documentation for PiknGo',
    },
    servers: [
      {
        url: 'http://localhost:5000',
        description: 'Development server',
      },
    ],
    paths: {
      '/api/auth/register': {
        post: {
          summary: 'Register a new user',
          description: 'Register a new user with email or phone',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    email: { type: 'string' },
                    phone: { type: 'string' },
                    password: { type: 'string' },
                    fullName: { type: 'string' }
                  },
                  required: ['password']
                }
              }
            }
          },
          responses: {
            '201': {
              description: 'User registered successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      msg: { type: 'string' },
                      token: { type: 'string' },
                      user: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          email: { type: 'string' },
                          phone: { type: 'string' },
                          fullName: { type: 'string' },
                          role: { type: 'string' },
                          emailVerified: { type: 'boolean' },
                          phoneVerified: { type: 'boolean' }
                        }
                      }
                    }
                  }
                }
              }
            },
            '400': {
              description: 'Bad request'
            },
            '500': {
              description: 'Server error'
            }
          }
        }
      },
      '/api/auth/verify-email': {
        post: {
          summary: 'Verify user email',
          description: 'Verify user email with the provided token',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    email: { type: 'string' },
                    token: { type: 'string' }
                  },
                  required: ['email', 'token']
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Email verified successfully'
            },
            '400': {
              description: 'Invalid token or user not found'
            },
            '500': {
              description: 'Server error'
            }
          }
        }
      },
      '/api/auth/verify-phone': {
        post: {
          summary: 'Verify user phone',
          description: 'Verify user phone with the provided token',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    phone: { type: 'string' },
                    token: { type: 'string' }
                  },
                  required: ['phone', 'token']
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Phone verified successfully'
            },
            '400': {
              description: 'Invalid token or user not found'
            },
            '500': {
              description: 'Server error'
            }
          }
        }
      },
      '/api/auth/login': {
        post: {
          summary: 'User login',
          description: 'Login with email/phone and password',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    email: { type: 'string' },
                    phone: { type: 'string' },
                    password: { type: 'string' }
                  },
                  required: ['password']
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Login successful',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      token: { type: 'string' }
                    }
                  }
                }
              }
            },
            '400': {
              description: 'Invalid credentials or unverified user'
            },
            '500': {
              description: 'Server error'
            }
          }
        }
      },
      '/api/tasks/taskers': {
        post: {
          summary: 'Create a new tasker profile',
          description: 'Create a tasker profile for the authenticated user',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    skills: { 
                      type: 'array',
                      items: { type: 'string' }
                    },
                    availability: {
                      type: 'object',
                      properties: {
                        days: { type: 'array', items: { type: 'string' } },
                        hours: { type: 'array', items: { type: 'string' } }
                      }
                    },
                    currentLocation: {
                      type: 'object',
                      properties: {
                        type: { type: 'string', default: 'Point' },
                        coordinates: { 
                          type: 'array',
                          items: { type: 'number' }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          responses: {
            '201': {
              description: 'Tasker profile created successfully'
            },
            '400': {
              description: 'Bad request'
            },
            '401': {
              description: 'Unauthorized'
            }
          }
        }
      },
      '/api/tasks/tasks': {
        post: {
          summary: 'Create a new task',
          description: 'Create a new task and automatically match with best tasker',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    description: { type: 'string' },
                    location: {
                      type: 'object',
                      properties: {
                        type: { type: 'string', default: 'Point' },
                        coordinates: { 
                          type: 'array',
                          items: { type: 'number' }
                        }
                      }
                    },
                    requiredSkills: {
                      type: 'array',
                      items: { type: 'string' }
                    }
                  }
                }
              }
            }
          },
          responses: {
            '201': {
              description: 'Task created successfully'
            },
            '400': {
              description: 'Bad request'
            },
            '401': {
              description: 'Unauthorized'
            }
          }
        },
        get: {
          summary: 'Get all tasks',
          description: 'Retrieve all tasks with creator and assigned tasker details',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': {
              description: 'Tasks retrieved successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      data: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            title: { type: 'string' },
                            description: { type: 'string' },
                            status: { type: 'string' },
                            creator: {
                              type: 'object',
                              properties: {
                                name: { type: 'string' },
                                email: { type: 'string' }
                              }
                            },
                            assignedTasker: {
                              type: 'object',
                              properties: {
                                name: { type: 'string' },
                                email: { type: 'string' }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            },
            '401': {
              description: 'Unauthorized'
            }
          }
        }
      },
      '/api/tasks/tasks/{taskId}/status': {
        put: {
          summary: 'Update task status',
          description: 'Update the status of a task (only by assigned tasker)',
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: 'path',
              name: 'taskId',
              required: true,
              schema: {
                type: 'string'
              },
              description: 'Task ID'
            }
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: {
                      type: 'string',
                      enum: ['pending', 'in-progress', 'completed', 'cancelled']
                    }
                  }
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Task status updated successfully'
            },
            '400': {
              description: 'Bad request'
            },
            '401': {
              description: 'Unauthorized'
            },
            '403': {
              description: 'Forbidden - Not authorized to update this task'
            },
            '404': {
              description: 'Task not found'
            }
          }
        }
      }
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      }
    }
  },
  apis: ['./routes/*.js'], // Path to the API routes
};

const specs = swaggerJsdoc(options);

module.exports = {
  serve: swaggerUi.serve,
  setup: swaggerUi.setup(specs),
  specs,
};
