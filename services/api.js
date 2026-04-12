export const activateTechnician = (technicianId) => api.post(`/auth/activate-technician/${technicianId}`);


api.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 403 && 
        error.response?.data?.message?.includes('not yet activated')) {
      window.location.href = '/login?inactive=true';
    }
    return Promise.reject(error);
  }
);