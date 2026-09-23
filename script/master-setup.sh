#!/bin/bash
# scripts/master-setup.sh
# Complete setup script for Generator Management System
# Run with: bash scripts/master-setup.sh

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Logging functions
log_info() {
    echo -e "${CYAN}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

log_header() {
    echo ""
    echo -e "${BOLD}${BLUE}============================================================${NC}"
    echo -e "${BOLD}$1${NC}"
    echo -e "${BOLD}${BLUE}============================================================${NC}"
    echo ""
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
check_prerequisites() {
    log_header "CHECKING PREREQUISITES"
    
    local all_good=true
    
    # Check Node.js
    if command_exists node; then
        NODE_VERSION=$(node --version)
        log_success "Node.js installed: $NODE_VERSION"
    else
        log_error "Node.js is not installed"
        all_good=false
    fi
    
    # Check npm
    if command_exists npm; then
        NPM_VERSION=$(npm --version)
        log_success "npm installed: $NPM_VERSION"
    else
        log_error "npm is not installed"
        all_good=false
    fi
    
    # Check MongoDB
    if command_exists mongosh || command_exists mongo; then
        log_success "MongoDB CLI installed"
        
        # Try to connect
        if mongosh --eval "db.version()" >/dev/null 2>&1 || mongo --eval "db.version()" >/dev/null 2>&1; then
            log_success "MongoDB is running"
        else
            log_warning "MongoDB is installed but not running"
            echo "  Try: sudo systemctl start mongodb"
            all_good=false
        fi
    else
        log_error "MongoDB is not installed"
        all_good=false
    fi
    
    if [ "$all_good" = false ]; then
        log_error "Please install missing prerequisites before continuing"
        exit 1
    fi
    
    log_success "All prerequisites met!"
}

# Setup environment
setup_environment() {
    log_header "SETTING UP ENVIRONMENT"
    
    if [ -f .env ]; then
        log_warning ".env file already exists"
        read -p "Do you want to overwrite it? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Keeping existing .env file"
            return 0
        fi
    fi
    
    log_info "Creating .env file..."
    
    cat > .env << EOF
# Server Configuration
PORT=5000
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/generator-management

# JWT Secrets
JWT_SECRET=$(openssl rand -base64 32)
JWT_REFRESH_SECRET=$(openssl rand -base64 32)
JWT_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=30d

# CORS
CLIENT_URL=http://localhost:3000

# File Upload
MAX_FILE_SIZE=25000000
UPLOAD_PATH=./uploads

# Email Configuration (Optional)
# EMAIL_HOST=smtp.gmail.com
# EMAIL_PORT=587
# EMAIL_USER=your_email@gmail.com
# EMAIL_PASSWORD=your_password

# Logging
LOG_LEVEL=info
EOF
    
    log_success ".env file created with random JWT secrets"
}

# Install dependencies
install_dependencies() {
    log_header "INSTALLING DEPENDENCIES"
    
    log_info "Running npm install..."
    if npm install; then
        log_success "Dependencies installed successfully"
    else
        log_error "Failed to install dependencies"
        exit 1
    fi
}

# Create required directories
create_directories() {
    log_header "CREATING REQUIRED DIRECTORIES"
    
    local dirs=("uploads" "uploads/temp" "uploads/photos" "uploads/attachments" "logs" "backups")
    
    for dir in "${dirs[@]}"; do
        if [ ! -d "$dir" ]; then
            mkdir -p "$dir"
            log_success "Created directory: $dir"
        else
            log_info "Directory already exists: $dir"
        fi
    done
    
    # Set permissions
    chmod 755 uploads
    chmod 755 logs
    log_success "Permissions set correctly"
}

# Setup database
setup_database() {
    log_header "SETTING UP DATABASE"
    
    log_info "Creating database and collections..."
    
    # Use mongosh or mongo depending on what's available
    if command_exists mongosh; then
        MONGO_CMD="mongosh"
    else
        MONGO_CMD="mongo"
    fi
    
    $MONGO_CMD generator-management --eval "
        db.createCollection('users');
        db.createCollection('sites');
        db.createCollection('clusters');
        db.createCollection('maintenances');
        db.createCollection('fuelconsumptions');
        db.createCollection('parts');
        print('Collections created successfully');
    " >/dev/null 2>&1
    
    log_success "Database collections created"
}

# Setup users
setup_users() {
    log_header "CREATING USER ROLES"
    
    log_info "Running user setup script..."
    if node scripts/setupUserRoles.js; then
        log_success "User roles created successfully"
    else
        log_error "Failed to create user roles"
        exit 1
    fi
}

# Verify setup
verify_setup() {
    log_header "VERIFYING SETUP"
    
    log_info "Running verification script..."
    if node scripts/verifyUserSetup.js; then
        log_success "Setup verification passed"
    else
        log_warning "Setup verification found some issues"
    fi
}

# Create sample data
create_sample_data() {
    log_header "SAMPLE DATA"
    
    read -p "Do you want to create sample data for testing? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        log_info "Creating sample data..."
        
        # Here you would call a sample data creation script
        # For now, we'll just log that it's skipped
        log_warning "Sample data creation not yet implemented"
        log_info "You can manually add sites through the API"
    else
        log_info "Skipping sample data creation"
    fi
}

# Print credentials
print_credentials() {
    log_header "LOGIN CREDENTIALS"
    
    echo ""
    echo -e "${BOLD}Default User Accounts:${NC}"
    echo ""
    echo -e "${RED}ADMIN${NC}             admin@generator.cm              ${BOLD}Admin@2025${NC}"
    echo -e "${BLUE}SUPERVISOR${NC}        supervisor@generator.cm         ${BOLD}Super@2025${NC}"
    echo -e "${GREEN}TECHNICIAN${NC}        technician@generator.cm         ${BOLD}Tech@2025${NC}"
    echo -e "${YELLOW}DIESEL MANAGER${NC}    diesel@generator.cm             ${BOLD}Diesel@2025${NC}"
    echo -e "${CYAN}DATA COLLECTOR${NC}    data@generator.cm               ${BOLD}Data@2025${NC}"
    echo "ANALYST           analyst@generator.cm            ${BOLD}Analyst@2025${NC}"
    echo ""
    log_warning "IMPORTANT: Change these passwords after first login!"
    echo ""
}

# Print next steps
print_next_steps() {
    log_header "NEXT STEPS"
    
    echo ""
    echo "✅ Setup complete! Here's what to do next:"
    echo ""
    echo "1. Start the server:"
    echo -e "   ${CYAN}npm run dev${NC}"
    echo ""
    echo "2. Test the API:"
    echo -e "   ${CYAN}curl http://localhost:5000/health${NC}"
    echo ""
    echo "3. Login to the system:"
    echo -e "   ${CYAN}curl -X POST http://localhost:5000/api/auth/login \\${NC}"
    echo -e "   ${CYAN}  -H \"Content-Type: application/json\" \\${NC}"
    echo -e "   ${CYAN}  -d '{\"email\":\"admin@generator.cm\",\"password\":\"Admin@2025\"}'${NC}"
    echo ""
    echo "4. Import Postman collection for API testing:"
    echo "   File: tests/Generator-Management.postman_collection.json"
    echo ""
    echo "5. Start frontend (if available):"
    echo -e "   ${CYAN}cd ../frontend && npm start${NC}"
    echo ""
    
    log_info "For detailed documentation, see:"
    echo "   - README.md"
    echo "   - API_DOCUMENTATION.md"
    echo "   - USER_ROLES_SETUP_README.md"
    echo ""
}

# Main setup flow
main() {
    clear
    
    log_header "GENERATOR MANAGEMENT SYSTEM - SETUP"
    
    echo "This script will set up your Generator Management System backend."
    echo "It will:"
    echo "  • Check prerequisites"
    echo "  • Install dependencies"
    echo "  • Create environment configuration"
    echo "  • Set up database"
    echo "  • Create user roles"
    echo "  • Verify installation"
    echo ""
    
    read -p "Continue with setup? (Y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        log_info "Setup cancelled"
        exit 0
    fi
    
    # Run setup steps
    check_prerequisites
    setup_environment
    install_dependencies
    create_directories
    setup_database
    setup_users
    verify_setup
    create_sample_data
    
    # Print summary
    print_credentials
    print_next_steps
    
    log_success "Setup completed successfully! 🎉"
}

# Run main function
main