require('dotenv').config();
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

// Brand Colors
const COLORS = {
  primary: '#2563eb',      // Modern blue
  secondary: '#7c3aed',    // Purple
  accent: '#f59e0b',       // Amber
  success: '#10b981',      // Green
  danger: '#ef4444',       // Red
  dark: '#1e293b',         // Slate dark
  gray: '#64748b',         // Slate gray
  light: '#f1f5f9',        // Slate light
  white: '#ffffff'
};

// Personal Statement Data
const statementData = {
  author: {
    name: 'Ngong Marcel Yiosimbom',
    position: 'IT Officer',
    reportsTo: 'Head of Business',
    preparedFor: 'Chief Executive Officer',
    education: 'Software Engineering, University of Bamenda',
    startDate: 'May 21, 2025'
  },
  period: {
    start: 'May 21, 2025',
    end: 'December 16, 2025',
    date: 'December 16, 2025'
  },
  company: 'Grato Engineering Global LTD'
};

class CreativePDFGenerator {
  constructor(outputFilename) {
    this.outputFilename = outputFilename;
    this.doc = null;
    this.stream = null;
    this.pageNumber = 1;
    this.hasLogo = false;
    this.logoPath = null;
    
    // Setup paths
    const exportDir = path.join(__dirname, 'exports');
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    this.filepath = path.join(exportDir, `${outputFilename}_${timestamp}.pdf`);
    
    this.logoPath = path.join(__dirname, 'public/images/company-logo.jpg');
    this.hasLogo = fs.existsSync(this.logoPath);
  }

  // Initialize PDF Document
  init() {
    this.doc = new PDFDocument({ 
      size: 'A4', 
      margin: 0,
      bufferPages: true,
      autoFirstPage: false,
      info: {
        Title: 'IT Officer Personal Statement - Strategic Vision',
        Author: statementData.author.name,
        Subject: 'IT Department Performance Review & Future Strategy',
        Keywords: 'IT Performance, Digital Transformation, Strategic Planning'
      }
    });

    this.stream = fs.createWriteStream(this.filepath);
    this.doc.pipe(this.stream);
  }

  // Add watermark
  addWatermark() {
    if (this.hasLogo) {
      this.doc.save();
      this.doc.opacity(0.05);
      try {
        this.doc.image(this.logoPath, 197.5, 350, { width: 200 });
      } catch (err) {
        console.warn('Could not add watermark');
      }
      this.doc.opacity(1);
      this.doc.restore();
    }
  }

  // Modern page footer with gradient
  addModernFooter() {
    const footerY = 770;
    
    // Gradient line
    this.doc.save();
    const gradient = this.doc.linearGradient(50, footerY, 545, footerY);
    gradient.stop(0, COLORS.primary).stop(0.5, COLORS.secondary).stop(1, COLORS.accent);
    this.doc.rect(50, footerY, 495, 2).fill(gradient);
    this.doc.restore();
    
    // Footer text
    this.doc.fontSize(7).fillColor(COLORS.gray).font('Helvetica')
       .text(`${statementData.company} | Confidential`, 50, footerY + 8, { 
         width: 200, 
         align: 'left' 
       })
       .text(`Page ${this.pageNumber}`, 345, footerY + 8, { 
         width: 200, 
         align: 'right' 
       });
    
    this.pageNumber++;
  }

  // Sidebar navigation (visual only)
  addSidebar(activeSection = '') {
    const sections = [
      { name: 'Overview', icon: '◆', color: COLORS.primary },
      { name: 'Systems', icon: '◆', color: COLORS.secondary },
      { name: 'Impact', icon: '◆', color: COLORS.success },
      { name: 'Vision', icon: '◆', color: COLORS.accent }
    ];
    
    this.doc.rect(0, 0, 40, 842).fill('#f8fafc');
    
    let y = 120;
    sections.forEach(section => {
      const isActive = section.name.toLowerCase() === activeSection.toLowerCase();
      const color = isActive ? section.color : COLORS.gray;
      
      if (isActive) {
        this.doc.rect(0, y - 10, 40, 35).fill(color).opacity(0.1);
        this.doc.opacity(1);
      }
      
      this.doc.fontSize(16).fillColor(color)
         .text(section.icon, 12, y, { width: 16, align: 'center' });
      
      y += 60;
    });
  }

  // Modern header with gradient
  addModernHeader(title = '', subtitle = '') {
    // Top gradient bar
    const gradient = this.doc.linearGradient(0, 0, 595, 0);
    gradient.stop(0, COLORS.primary).stop(0.5, COLORS.secondary).stop(1, COLORS.accent);
    this.doc.rect(0, 0, 595, 4).fill(gradient);
    
    // Logo
    if (this.hasLogo) {
      try {
        this.doc.image(this.logoPath, 60, 20, { width: 50, height: 50 });
      } catch (err) {
        console.warn('Could not add logo');
      }
    }
    
    // Company name
    this.doc.fontSize(11).fillColor(COLORS.dark).font('Helvetica-Bold')
       .text(statementData.company, 120, 28);
    
    this.doc.fontSize(8).fillColor(COLORS.gray).font('Helvetica')
       .text('IT Department | Strategic Report', 120, 44);
    
    // Section title (if provided)
    if (title) {
      this.doc.fontSize(9).fillColor(COLORS.primary).font('Helvetica-Bold')
         .text(title.toUpperCase(), 400, 32, { width: 135, align: 'right' });
    }
    
    if (subtitle) {
      this.doc.fontSize(7).fillColor(COLORS.gray).font('Helvetica')
         .text(subtitle, 400, 46, { width: 135, align: 'right' });
    }
  }

  // Helper to adjust color brightness
  adjustColorBrightness(hex, percent) {
    const num = parseInt(hex.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = (num >> 8 & 0x00FF) + amt;
    const B = (num & 0x0000FF) + amt;
    return '#' + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
      (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
      (B < 255 ? B < 1 ? 0 : B : 255))
      .toString(16).slice(1);
  }

  // Create stunning cover page
  createCoverPage() {
    this.doc.addPage();
    this.addWatermark();
    
    // Geometric background pattern
    this.doc.save();
    this.doc.opacity(0.03);
    for (let i = 0; i < 20; i++) {
      const x = Math.random() * 595;
      const y = Math.random() * 842;
      const size = Math.random() * 100 + 50;
      this.doc.circle(x, y, size).fill(COLORS.primary);
    }
    this.doc.opacity(1);
    this.doc.restore();
    
    // Top accent
    const topGradient = this.doc.linearGradient(0, 0, 595, 0);
    topGradient.stop(0, COLORS.primary).stop(1, COLORS.secondary);
    this.doc.rect(0, 0, 595, 180).fill(topGradient);
    
    // Logo in header (large)
    if (this.hasLogo) {
      try {
        this.doc.image(this.logoPath, 222.5, 40, { width: 150, height: 150 });
      } catch (err) {
        console.warn('Could not add cover logo');
      }
    }
    
    // Main title section
    this.doc.fontSize(42).fillColor(COLORS.white).font('Helvetica-Bold')
       .text('PERSONAL', 50, 230, { align: 'center' })
       .text('STATEMENT', 50, 280, { align: 'center' });
    
    // Subtitle with accent line
    this.doc.rect(180, 345, 235, 3).fill(COLORS.accent);
    
    this.doc.fontSize(16).fillColor(COLORS.dark).font('Helvetica')
       .text('IT Department Performance', 50, 365, { align: 'center' })
       .text('& Strategic Vision 2025-2030', 50, 390, { align: 'center' });
    
    // Info cards
    const cardY = 450;
    const cardWidth = 150;
    const cardHeight = 100;
    const spacing = 22.5;
    
    const cards = [
      { label: 'Author', value: statementData.author.name, color: COLORS.primary },
      { label: 'Position', value: statementData.author.position, color: COLORS.secondary },
      { label: 'Period', value: '7 Months', color: COLORS.accent }
    ];
    
    cards.forEach((card, i) => {
      const x = 50 + (i * (cardWidth + spacing));
      
      // Card shadow
      this.doc.save();
      this.doc.opacity(0.1);
      this.doc.roundedRect(x + 3, cardY + 3, cardWidth, cardHeight, 8).fill(COLORS.dark);
      this.doc.opacity(1);
      this.doc.restore();
      
      // Card
      this.doc.roundedRect(x, cardY, cardWidth, cardHeight, 8)
         .fill(COLORS.white)
         .stroke();
      
      // Colored top bar
      this.doc.roundedRect(x, cardY, cardWidth, 4, 8).fill(card.color);
      
      // Content
      this.doc.fontSize(9).fillColor(COLORS.gray).font('Helvetica')
         .text(card.label.toUpperCase(), x + 15, cardY + 25);
      
      this.doc.fontSize(11).fillColor(COLORS.dark).font('Helvetica-Bold')
         .text(card.value, x + 15, cardY + 45, { width: cardWidth - 30, lineBreak: true });
    });
    
    // Bottom info
    this.doc.fontSize(10).fillColor(COLORS.dark).font('Helvetica-Bold')
       .text('Document Information', 50, 590);
    
    this.doc.fontSize(9).fillColor(COLORS.gray).font('Helvetica')
       .text(`Prepared for: ${statementData.author.preparedFor}`, 50, 610)
       .text(`Reports to: ${statementData.author.reportsTo}`, 50, 628)
       .text(`Company: ${statementData.company}`, 50, 646)
       .text(`Date: ${statementData.period.date}`, 50, 664);
    
    // Confidential banner
    this.doc.rect(0, 750, 595, 40).fill(COLORS.light);
    this.doc.fontSize(8).fillColor(COLORS.gray).font('Helvetica-Oblique')
       .text('CONFIDENTIAL - For Internal Management Review', 50, 763, { 
         align: 'center',
         width: 495
       });
    
    this.addModernFooter();
  }

  // Create executive summary with visual stats
  createExecutiveSummary() {
    this.doc.addPage();
    this.addWatermark();
    this.addSidebar('overview');
    this.addModernHeader('Executive Summary', 'Overview');
    
    // Title with accent
    this.doc.fontSize(28).fillColor(COLORS.dark).font('Helvetica-Bold')
       .text('Executive Summary', 60, 100);
    
    this.doc.rect(60, 135, 80, 4).fill(COLORS.primary);
    
    // Summary text
    this.doc.fontSize(11).fillColor(COLORS.dark).font('Helvetica')
       .text(
         'Since joining Grato Engineering Global on May 21, 2025, I have established the company\'s first dedicated IT department, implementing foundational systems and policies that have transformed our operational capabilities.',
         60, 160, { width: 475, lineGap: 4 }
       );
    
    // Key metrics cards
    const metrics = [
      { label: 'ERP Users', value: '27+', icon: '👥', color: COLORS.primary },
      { label: 'Systems Built', value: '3', icon: '⚙️', color: COLORS.secondary },
      { label: 'Coverage', value: '100%', icon: '📡', color: COLORS.success },
      { label: 'Savings', value: '15-20%', icon: '💰', color: COLORS.accent }
    ];
    
    let metricY = 240;
    metrics.forEach((metric, i) => {
      const x = 60 + (i % 2) * 250;
      const myY = i < 2 ? 240 : 340;
      
      // Card with gradient
      const gradient = this.doc.linearGradient(x, myY, x + 220, myY);
      gradient.stop(0, metric.color).stop(1, this.adjustColorBrightness(metric.color, 20));
      
      this.doc.roundedRect(x, myY, 220, 80, 10).fill(COLORS.white);
      this.doc.roundedRect(x, myY, 220, 6, 10).fill(gradient);
      
      // Icon
      this.doc.fontSize(24).fillColor(metric.color)
         .text(metric.icon, x + 15, myY + 20);
      
      // Value
      this.doc.fontSize(32).fillColor(COLORS.dark).font('Helvetica-Bold')
         .text(metric.value, x + 55, myY + 15);
      
      // Label
      this.doc.fontSize(10).fillColor(COLORS.gray).font('Helvetica')
         .text(metric.label, x + 55, myY + 52);
    });
    
    // Key achievements
    this.doc.fontSize(16).fillColor(COLORS.dark).font('Helvetica-Bold')
       .text('Key Achievements', 60, 460);
    
    const achievements = [
      'Built custom ERP system saving 99.9% vs commercial solutions',
      'Established company\'s first IT Policy and governance framework',
      'Achieved 90% IT asset utilization and 100% office connectivity',
      'Developed two specialized management systems (90% complete)',
      'Created comprehensive 2026-2030 digital transformation roadmap'
    ];
    
    let achY = 490;
    achievements.forEach(achievement => {
      // Checkmark with color
      this.doc.circle(70, achY + 6, 8).fill(COLORS.success).opacity(0.2);
      this.doc.opacity(1);
      this.doc.fontSize(14).fillColor(COLORS.success).font('Helvetica-Bold')
         .text('✓', 65, achY);
      
      // Achievement text
      this.doc.fontSize(10).fillColor(COLORS.dark).font('Helvetica')
         .text(achievement, 95, achY + 2, { width: 440 });
      
      achY += 32;
    });
    
    this.addModernFooter();
  }

  // Create timeline page
  createTimeline() {
    this.doc.addPage();
    this.addWatermark();
    this.addSidebar('overview');
    this.addModernHeader('Journey Timeline', 'May - December 2025');
    
    this.doc.fontSize(28).fillColor(COLORS.dark).font('Helvetica-Bold')
       .text('My Journey at Grato', 60, 100);
    
    this.doc.rect(60, 135, 100, 4).fill(COLORS.secondary);
    
    // Timeline events
    const events = [
      { month: 'MAY', title: 'Joined Grato', desc: 'Started as IT Officer, assessed infrastructure needs', color: COLORS.primary },
      { month: 'JUN-SEP', title: 'ERP Development', desc: 'Built 15-module ERP system from scratch', color: COLORS.secondary },
      { month: 'OCT', title: 'ERP Deployment', desc: 'Successfully launched ERP to 27+ users', color: COLORS.success },
      { month: 'NOV', title: 'Policy & Systems', desc: 'Published IT Policy, advanced Fleet & Technician systems', color: COLORS.accent },
      { month: 'DEC', title: 'Strategic Planning', desc: 'Completed server study, created 2030 roadmap', color: COLORS.primary }
    ];
    
    const startY = 180;
    const lineX = 130;
    
    // Vertical timeline line
    this.doc.moveTo(lineX, startY).lineTo(lineX, startY + (events.length - 1) * 110 + 50)
       .lineWidth(2).strokeColor(COLORS.light).stroke();
    
    events.forEach((event, i) => {
      const y = startY + (i * 110);
      
      // Timeline dot
      this.doc.circle(lineX, y, 12).fill(event.color);
      this.doc.circle(lineX, y, 8).fill(COLORS.white);
      this.doc.circle(lineX, y, 4).fill(event.color);
      
      // Month badge
      this.doc.roundedRect(60, y - 15, 55, 30, 5).fill(event.color);
      this.doc.fontSize(9).fillColor(COLORS.white).font('Helvetica-Bold')
         .text(event.month, 60, y - 7, { width: 55, align: 'center' });
      
      // Content card
      this.doc.roundedRect(160, y - 25, 375, 70, 8)
         .fill(COLORS.white)
         .lineWidth(1)
         .strokeColor(event.color)
         .fillAndStroke();
      
      // Title
      this.doc.fontSize(13).fillColor(event.color).font('Helvetica-Bold')
         .text(event.title, 175, y - 10);
      
      // Description
      this.doc.fontSize(10).fillColor(COLORS.gray).font('Helvetica')
         .text(event.desc, 175, y + 10, { width: 345 });
    });
    
    this.addModernFooter();
  }

  // Get system features
  getSystemFeatures(systemName) {
    const features = {
      'Enterprise Resource Planning (ERP)': [
        'Petty Cash & Budget Management with multi-level approval workflows',
        'Project Management with task tracking and milestone monitoring',
        'HR Portal: Leave management, employee records, onboarding',
        'Inventory & Asset Management: Real-time tracking, requisitions',
        'Procurement: Purchase requisitions, PO generation, supplier management',
        'Financial: Invoicing system, expense tracking, audit trails',
        'Collaboration: File sharing, internal communications, suggestions',
        'IT Support: Ticketing system, equipment requests, incident reporting'
      ],
      'Technician Reporting System': [
        'Digital Site Visit Management: Scheduling, tracking, historical records',
        'Generator Monitoring: Status tracking, runtime hours, fuel consumption',
        'Parts Inventory: Usage recording, automatic deduction, stock alerts',
        'Fuel Management: Level monitoring, consumption analysis, request workflows',
        'Maintenance Tracking: PM/Emergency/Refueling operations logging',
        'Data Quality: Automated validation, quality scoring, anomaly detection',
        'Approval Workflows: Supervisor review, multi-level authorization',
        'Reporting: Real-time dashboards, automated reports, data exports'
      ],
      'Fleet Management System': [
        'Vehicle Registry: Complete profiles, assignment history, status tracking',
        'Fault Reporting: Digital submission, categorization, downtime calculation',
        'Daily Inspections: Digital checklists, condition assessment, compliance',
        'Maintenance Scheduling: Preventive calendar, service tracking, cost analysis',
        'Replacement Workflow: Automatic replacement vehicle assignment logic',
        'Analytics Dashboard: Utilization rates, downtime analysis, cost tracking',
        'Performance Benchmarking: Cross-fleet comparisons, efficiency metrics',
        'Lifecycle Management: Complete vehicle history from procurement to disposal'
      ]
    };
    
    return features[systemName] || [];
  }

  // Create systems overview with visual cards
  createSystemsOverview() {
    this.doc.addPage();
    this.addWatermark();
    this.addSidebar('systems');
    this.addModernHeader('Systems Portfolio', 'Built & Deployed');
    
    this.doc.fontSize(28).fillColor(COLORS.dark).font('Helvetica-Bold')
       .text('Systems Portfolio', 60, 100);
    
    this.doc.rect(60, 135, 100, 4).fill(COLORS.primary);
    
    // System cards
    const systems = [
      {
        name: 'Enterprise Resource Planning (ERP)',
        status: 'DEPLOYED',
        statusColor: COLORS.success,
        icon: '🎯',
        modules: '15 Integrated Modules',
        users: '27+ Daily Users',
        uptime: '>99% Uptime',
        adoption: '95% Adoption Rate',
        cost: '~10,000 XAF vs 24-36M XAF/year (Odoo)',
        gradient: [COLORS.primary, COLORS.secondary]
      },
      {
        name: 'Technician Reporting System',
        status: '90% COMPLETE',
        statusColor: COLORS.accent,
        icon: '🔧',
        modules: 'Field Operations Platform',
        users: '10 Technicians',
        uptime: '150+ Sites Managed',
        adoption: '7 Clusters',
        cost: 'Independent System',
        gradient: [COLORS.secondary, COLORS.accent]
      },
      {
        name: 'Fleet Management System',
        status: '90% COMPLETE',
        statusColor: COLORS.accent,
        icon: '🚗',
        modules: 'Vehicle Lifecycle Tracking',
        users: '7 Vehicles',
        uptime: '7 Clusters',
        adoption: '20-30% Downtime Reduction',
        cost: 'Projected Savings: 10-15%',
        gradient: [COLORS.accent, COLORS.danger]
      }
    ];
    
    systems.forEach((system, i) => {
      if (i > 0) {
        this.doc.addPage();
        this.addWatermark();
        this.addSidebar('systems');
        this.addModernHeader('Systems Portfolio', system.name);
      }
      
      let sysY = i === 0 ? 170 : 100;
      
      // System card
      const gradient = this.doc.linearGradient(60, sysY, 535, sysY);
      gradient.stop(0, system.gradient[0]).stop(1, system.gradient[1]);
      
      this.doc.roundedRect(60, sysY, 475, 140, 12)
         .fill(gradient);
      
      // Icon
      this.doc.fontSize(48).fillColor(COLORS.white)
         .text(system.icon, 80, sysY + 40);
      
      // System name
      this.doc.fontSize(18).fillColor(COLORS.white).font('Helvetica-Bold')
         .text(system.name, 155, sysY + 30);
      
      // Status badge
      this.doc.roundedRect(155, sysY + 60, 120, 24, 12)
         .fill(COLORS.white);
      this.doc.fontSize(10).fillColor(system.statusColor).font('Helvetica-Bold')
         .text(system.status, 155, sysY + 67, { width: 120, align: 'center' });
      
      // Stats row 1
      this.doc.fontSize(9).fillColor(COLORS.white).font('Helvetica')
         .text(system.modules, 155, sysY + 90)
         .text(system.users, 340, sysY + 90);
      
      // Stats row 2
      this.doc.fontSize(9).fillColor(COLORS.white).font('Helvetica')
         .text(system.uptime, 155, sysY + 105)
         .text(system.adoption, 340, sysY + 105);
      
      // Cost info
      this.doc.fontSize(9).fillColor(COLORS.white).font('Helvetica-Oblique')
         .text(system.cost, 155, sysY + 120, { width: 360 });
      
      // Detailed features below card
      sysY += 160;
      
      this.doc.fontSize(16).fillColor(COLORS.dark).font('Helvetica-Bold')
         .text('Key Features & Capabilities', 60, sysY);
      
      sysY += 35;
      
      const features = this.getSystemFeatures(system.name);
      features.forEach(feature => {
        this.doc.rect(70, sysY, 4, 18).fill(system.gradient[0]);
        this.doc.fontSize(10).fillColor(COLORS.dark).font('Helvetica')
           .text(feature, 85, sysY + 2, { width: 445 });
        sysY += 26;
      });
      
      this.addModernFooter();
    });
  }

  // Create impact & metrics page with charts
  createImpactMetrics() {
    this.doc.addPage();
    this.addWatermark();
    this.addSidebar('impact');
    this.addModernHeader('Measurable Impact', 'Performance Metrics');
    
    this.doc.fontSize(28).fillColor(COLORS.dark).font('Helvetica-Bold')
       .text('Measurable Impact', 60, 100);
    
    this.doc.rect(60, 135, 120, 4).fill(COLORS.success);
    
    // Cost savings visualization
    this.doc.fontSize(18).fillColor(COLORS.dark).font('Helvetica-Bold')
       .text('Cost Optimization Achievements', 60, 170);
    
    const savings = [
      { category: 'Custom ERP vs Odoo', percentage: 99.9, amount: '120M+ XAF (5yr)', color: COLORS.success },
      { category: 'Telecommunications', percentage: 17.5, amount: '15-20% reduction', color: COLORS.primary },
      { category: 'Subscriptions', percentage: 12.5, amount: '10-15% savings', color: COLORS.secondary },
      { category: 'Process Efficiency', percentage: 65, amount: '60-70% faster', color: COLORS.accent }
    ];
    
    let barY = 220;
    savings.forEach(saving => {
      // Category label
      this.doc.fontSize(11).fillColor(COLORS.dark).font('Helvetica-Bold')
         .text(saving.category, 60, barY);
      
      // Bar background
      this.doc.roundedRect(60, barY + 22, 300, 28, 14).fill(COLORS.light);
      
      // Bar fill (animated look with gradient)
      const barWidth = (saving.percentage / 100) * 300;
      const barGradient = this.doc.linearGradient(60, barY + 22, 60 + barWidth, barY + 22);
      barGradient.stop(0, saving.color).stop(1, this.adjustColorBrightness(saving.color, 20));
      this.doc.roundedRect(60, barY + 22, barWidth, 28, 14).fill(barGradient);
      
      // Percentage
      this.doc.fontSize(12).fillColor(COLORS.white).font('Helvetica-Bold')
         .text(`${saving.percentage}%`, 60 + barWidth - 45, barY + 28);
      
      // Amount
      this.doc.fontSize(10).fillColor(COLORS.gray).font('Helvetica')
         .text(saving.amount, 370, barY + 28);
      
      barY += 70;
    });
    
    // System performance metrics
    barY += 30;
    this.doc.fontSize(18).fillColor(COLORS.dark).font('Helvetica-Bold')
       .text('System Performance', 60, barY);
    
    const metrics = [
      { label: 'ERP Uptime', value: '99%+', icon: '⚡', color: COLORS.success },
      { label: 'User Adoption', value: '95%', icon: '👥', color: COLORS.primary },
      { label: 'Asset Utilization', value: '90%', icon: '💻', color: COLORS.secondary },
      { label: 'Coverage', value: '100%', icon: '📡', color: COLORS.accent }
    ];
    
    barY += 40;
    metrics.forEach((metric, i) => {
      const x = 60 + (i % 2) * 250;
      const y = barY + Math.floor(i / 2) * 100;
      
      // Metric card
      this.doc.roundedRect(x, y, 220, 80, 10)
         .fill(COLORS.white)
         .lineWidth(2)
         .strokeColor(metric.color)
         .stroke();
      
      // Icon
      this.doc.fontSize(28).fillColor(metric.color)
         .text(metric.icon, x + 15, y + 18);
      
      // Value
      this.doc.fontSize(26).fillColor(COLORS.dark).font('Helvetica-Bold')
         .text(metric.value, x + 70, y + 15);
      
      // Label
      this.doc.fontSize(10).fillColor(COLORS.gray).font('Helvetica')
         .text(metric.label, x + 70, y + 45);
    });
    
    this.addModernFooter();
  }

  // Create future vision page
  createFutureVision() {
    this.doc.addPage();
    this.addWatermark();
    this.addSidebar('vision');
    this.addModernHeader('Future Vision', '2026-2030 Roadmap');
    
    this.doc.fontSize(28).fillColor(COLORS.dark).font('Helvetica-Bold')
       .text('Digital Transformation Vision', 60, 100);
    
    this.doc.rect(60, 135, 150, 4).fill(COLORS.accent);
    
    // Vision phases
    const phases = [
      {
        period: '2025-2026',
        title: 'Foundation & Stabilization',
        color: COLORS.success,
        icon: '🏗️',
        goals: [
          'Deploy Technician & Fleet Management Systems',
          'Implement Server Infrastructure',
          'Establish IT team foundation',
          'Complete governance framework'
        ]
      },
      {
        period: '2027-2028',
        title: 'Optimization & Intelligence',
        color: COLORS.primary,
        icon: '🚀',
        goals: [
          'Implement AI & Advanced Analytics',
          'Deploy IoT monitoring systems',
          'Launch mobile-first applications',
          'Automate repetitive workflows'
        ]
      },
      {
        period: '2029-2030',
        title: 'Innovation & Leadership',
        color: COLORS.secondary,
        icon: '⭐',
        goals: [
          'Predictive maintenance & optimization',
          'AI-assisted decision making',
          'Emerging technology adoption',
          'Industry-leading IT capabilities'
        ]
      }
    ];
    
    let phaseY = 180;
    phases.forEach((phase, i) => {
      // Phase header
      const headerGradient = this.doc.linearGradient(60, phaseY, 535, phaseY);
      headerGradient.stop(0, phase.color).stop(1, this.adjustColorBrightness(phase.color, 20));
      
      this.doc.roundedRect(60, phaseY, 475, 50, 10).fill(headerGradient);
      
      // Icon
      this.doc.fontSize(32).fillColor(COLORS.white)
         .text(phase.icon, 75, phaseY + 8);
      
      // Period & Title
      this.doc.fontSize(14).fillColor(COLORS.white).font('Helvetica-Bold')
         .text(phase.period, 130, phaseY + 12);
      
      this.doc.fontSize(18).fillColor(COLORS.white).font('Helvetica-Bold')
         .text(phase.title, 220, phaseY + 10);
      
      // Goals
      phaseY += 70;
      phase.goals.forEach(goal => {
        // Bullet with phase color
        this.doc.circle(75, phaseY + 6, 5).fill(phase.color);
        
        this.doc.fontSize(10).fillColor(COLORS.dark).font('Helvetica')
           .text(goal, 95, phaseY, { width: 430 });
        
        phaseY += 24;
      });
      
      phaseY += 20;
    });
    
    // 2026 Priorities
    phaseY += 10;
    this.doc.fontSize(18).fillColor(COLORS.dark).font('Helvetica-Bold')
       .text('Top 3 Priorities for 2026', 60, phaseY);
    
    const priorities = [
      { num: '1', title: 'Technician System Launch', desc: 'Q1 2026 - Full deployment across 7 clusters', color: COLORS.danger },
      { num: '2', title: 'Fleet Management Launch', desc: 'Q2 2026 - Vehicle lifecycle optimization', color: COLORS.accent },
      { num: '3', title: 'Server Infrastructure', desc: 'Q3-Q4 2026 - On-premise data sovereignty', color: COLORS.primary }
    ];
    
    phaseY += 40;
    priorities.forEach(priority => {
      // Number badge
      this.doc.circle(75, phaseY + 12, 18).fill(priority.color);
      this.doc.fontSize(16).fillColor(COLORS.white).font('Helvetica-Bold')
         .text(priority.num, 68, phaseY + 5);
      
      // Content
      this.doc.fontSize(13).fillColor(COLORS.dark).font('Helvetica-Bold')
         .text(priority.title, 110, phaseY + 2);
      
      this.doc.fontSize(9).fillColor(COLORS.gray).font('Helvetica')
         .text(priority.desc, 110, phaseY + 20);
      
      phaseY += 50;
    });
    
    this.addModernFooter();
  }

  // Create commitment page
  createCommitment() {
    this.doc.addPage();
    this.addWatermark();
    this.addSidebar('vision');
    this.addModernHeader('My Commitment', 'Personal Dedication');
    
    // Hero section
    const heroGradient = this.doc.linearGradient(0, 100, 595, 100);
    heroGradient.stop(0, COLORS.primary).stop(0.5, COLORS.secondary).stop(1, COLORS.accent);
    this.doc.rect(60, 100, 475, 120).fill(heroGradient);
    
    this.doc.fontSize(32).fillColor(COLORS.white).font('Helvetica-Bold')
       .text('My Commitment', 80, 130, { align: 'left' });
    
    this.doc.fontSize(14).fillColor(COLORS.white).font('Helvetica')
       .text(
         'Seven months have been transformative. Grato gave me opportunity, trust, and autonomy. I\'m committed to ensuring this foundation serves the company for years to come.',
         80, 175, { width: 435, lineGap: 4 }
       );
    
    // Seven commitments
    const commitments = [
      { title: 'Long-Term Vision', desc: 'Building IT foundation for Grato\'s next decade', icon: '🎯' },
      { title: 'Ownership & Quality', desc: 'Treating every system as my own company', icon: '⭐' },
      { title: 'Continuous Improvement', desc: 'Never settling, always optimizing', icon: '📈' },
      { title: 'Transparent Communication', desc: 'Honest updates on progress and challenges', icon: '💬' },
      { title: 'Cost-Consciousness', desc: 'Delivering value for every XAF spent', icon: '💰' },
      { title: 'Knowledge Sharing', desc: 'Documenting and training to avoid single points of failure', icon: '📚' },
      { title: 'Strategic Partnership', desc: 'Aligning technology with business goals', icon: '🤝' }
    ];
    
    commitments.forEach((commitment, i) => {
      const x = 60 + (i % 2) * 250;
      const myY = 260 + Math.floor(i / 2) * 90;
      
      // Commitment card
      this.doc.roundedRect(x, myY, 230, 70, 8)
         .lineWidth(2)
         .strokeColor(COLORS.primary)
         .fillAndStroke(COLORS.white, COLORS.primary);
      
      // Icon
      this.doc.fontSize(24).fillColor(COLORS.primary)
         .text(commitment.icon, x + 15, myY + 12);
      
      // Title
      this.doc.fontSize(11).fillColor(COLORS.dark).font('Helvetica-Bold')
         .text(commitment.title, x + 55, myY + 15);
      
      // Description
      this.doc.fontSize(9).fillColor(COLORS.gray).font('Helvetica')
         .text(commitment.desc, x + 55, myY + 33, { width: 160, lineGap: 2 });
    });
    
    this.addModernFooter();
  }

  // Create lessons learned page
  createLessons() {
    this.doc.addPage();
    this.addWatermark();
    this.addSidebar('vision');
    this.addModernHeader('Lessons Learned', 'Growth & Insights');
    
    this.doc.fontSize(28).fillColor(COLORS.dark).font('Helvetica-Bold')
       .text('Lessons Learned', 60, 100);
    
    this.doc.rect(60, 135, 100, 4).fill(COLORS.secondary);
    
    // Key lesson highlight
    this.doc.roundedRect(60, 170, 475, 100, 12)
       .fill(COLORS.light);
    
    this.doc.fontSize(14).fillColor(COLORS.primary).font('Helvetica-Bold')
       .text('Most Important Lesson', 80, 190);
    
    this.doc.fontSize(12).fillColor(COLORS.dark).font('Helvetica-Oblique')
       .text(
         '"Building with user adoption in mind is as important as technical excellence. Balance capability with user-centered design, prioritizing training and change management equally with coding."',
         80, 220, { width: 435, lineGap: 4 }
       );
    
    // What I would do differently
    this.doc.fontSize(16).fillColor(COLORS.dark).font('Helvetica-Bold')
       .text('What I Would Do Differently', 60, 300);
    
    const improvements = [
      'Earlier stakeholder engagement in system design',
      'Phased rollout - deploy core features first',
      'More beta testing with real users'
    ];
    
    let impY = 335;
    improvements.forEach((improvement, i) => {
      this.doc.roundedRect(70, impY, 450, 35, 6)
         .fill(COLORS.white)
         .lineWidth(1)
         .strokeColor(COLORS.accent)
         .stroke();
      
      this.doc.fontSize(11).fillColor(COLORS.dark).font('Helvetica-Bold')
         .text(`${i + 1}`, 85, impY + 10);
      
      this.doc.fontSize(10).fillColor(COLORS.dark).font('Helvetica')
         .text(improvement, 110, impY + 11, { width: 390 });
      
      impY += 45;
    });
    
    // Key realizations
    this.doc.fontSize(16).fillColor(COLORS.dark).font('Helvetica-Bold')
       .text('Key Realizations', 60, 490);
    
    const realizations = [
      { title: 'Organizational > Technical', desc: 'Change management often harder than coding', color: COLORS.primary },
      { title: 'Relationships Matter', desc: 'Strong dept. relationships critical for adoption', color: COLORS.secondary },
      { title: 'Flexibility Required', desc: 'Requirements evolved rapidly, needed adaptability', color: COLORS.accent }
    ];
    
    let realY = 525;
    realizations.forEach(real => {
      // Side color bar
      this.doc.rect(60, realY, 4, 45).fill(real.color);
      
      this.doc.fontSize(12).fillColor(COLORS.dark).font('Helvetica-Bold')
         .text(real.title, 75, realY + 5);
      
      this.doc.fontSize(10).fillColor(COLORS.gray).font('Helvetica')
         .text(real.desc, 75, realY + 24, { width: 450 });
      
      realY += 55;
    });
    
    this.addModernFooter();
  }

  // Create professional closing page
  createClosingPage() {
    this.doc.addPage();
    this.addWatermark();
    
    // Gradient background
    const gradient = this.doc.linearGradient(0, 0, 0, 842);
    gradient.stop(0, COLORS.white).stop(0.5, COLORS.light).stop(1, COLORS.white);
    this.doc.rect(0, 0, 595, 842).fill(gradient);
    
    // Logo centered
    if (this.hasLogo) {
      try {
        this.doc.image(this.logoPath, 222.5, 150, { width: 150, height: 150 });
      } catch (err) {
        console.warn('Could not add closing logo');
      }
    }
    
    this.doc.fontSize(32).fillColor(COLORS.dark).font('Helvetica-Bold')
       .text('Thank You', 50, 330, { align: 'center' });
    
    this.doc.fontSize(14).fillColor(COLORS.gray).font('Helvetica')
       .text(
         'I\'m honored to lead Grato\'s digital transformation and committed to its continued success.',
         50, 380, { align: 'center', width: 495 }
       );
    
    // Signature section
    this.doc.moveTo(200, 450).lineTo(395, 450).lineWidth(2).strokeColor(COLORS.primary).stroke();
    
    this.doc.fontSize(16).fillColor(COLORS.dark).font('Helvetica-Bold')
       .text(statementData.author.name, 50, 470, { align: 'center' });
    
    this.doc.fontSize(11).fillColor(COLORS.gray).font('Helvetica')
       .text(statementData.author.position, 50, 495, { align: 'center' })
       .text(statementData.company, 50, 515, { align: 'center' });
    
    this.doc.fontSize(10).fillColor(COLORS.gray)
       .text(`Date: ${statementData.period.date}`, 50, 545, { align: 'center' });
    
    // Contact info card
    this.doc.roundedRect(147.5, 600, 300, 80, 10)
       .fill(COLORS.white)
       .lineWidth(2)
       .strokeColor(COLORS.primary)
       .stroke();
    
    this.doc.fontSize(10).fillColor(COLORS.dark).font('Helvetica-Bold')
       .text('Document Information', 147.5, 615, { width: 300, align: 'center' });
    
    this.doc.fontSize(9).fillColor(COLORS.gray).font('Helvetica')
       .text(`Reports to: ${statementData.author.reportsTo}`, 147.5, 635, { width: 300, align: 'center' })
       .text(`Prepared for: ${statementData.author.preparedFor}`, 147.5, 650, { width: 300, align: 'center' })
       .text(`Period: ${statementData.period.start} - ${statementData.period.end}`, 147.5, 665, { width: 300, align: 'center' });
    
    // Footer
    this.doc.fontSize(8).fillColor(COLORS.gray).font('Helvetica-Oblique')
       .text('Confidential - For Internal Management Review Only', 50, 750, { 
         align: 'center',
         width: 495
       });
    
    this.addModernFooter();
  }

  // Generate complete PDF
  async generate() {
    return new Promise((resolve, reject) => {
      try {
        console.log('🎨 Creating modern, professional PDF...\n');
        
        this.init();
        
        // Create all pages
        this.createCoverPage();
        this.createExecutiveSummary();
        this.createTimeline();
        this.createSystemsOverview();
        this.createImpactMetrics();
        this.createFutureVision();
        this.createCommitment();
        this.createLessons();
        this.createClosingPage();
        
        // Finalize
        this.doc.end();
        
        this.stream.on('finish', () => {
          console.log('\n✅ PDF Generated Successfully!');
          console.log(`📁 File: ${this.filepath}`);
          console.log(`📄 Pages: ${this.pageNumber - 1}`);
          console.log(`💾 Size: ${(fs.statSync(this.filepath).size / 1024).toFixed(2)} KB\n`);
          resolve(this.filepath);
        });
        
        this.stream.on('error', reject);
        
      } catch (error) {
        console.error('❌ PDF generation failed:', error.message);
        reject(error);
      }
    });
  }
}

// Parse arguments
function parseArgs() {
  const args = process.argv.slice(2);
  let filename = 'Personal_Statement_Creative';
  
  args.forEach(arg => {
    if (arg.startsWith('--filename=') || arg.startsWith('--output=')) {
      filename = arg.split('=')[1];
    }
  });
  
  return filename;
}

// Main execution
if (require.main === module) {
  console.log('🚀 Personal Statement PDF Generator');
  console.log('═'.repeat(50));
  console.log(`👤 Author: ${statementData.author.name}`);
  console.log(`🏢 Company: ${statementData.company}`);
  console.log(`📅 Period: ${statementData.period.start} - ${statementData.period.end}`);
  console.log('═'.repeat(50) + '\n');
  
  const filename = parseArgs();
  const generator = new CreativePDFGenerator(filename);
  
  generator.generate()
    .then(filepath => {
      console.log('🎉 PDF generation completed successfully!');
      console.log(`✨ Open the file to view your professional statement.\n`);
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Error:', error.message);
      console.error(error.stack);
      process.exit(1);
    });
}

module.exports = { CreativePDFGenerator };