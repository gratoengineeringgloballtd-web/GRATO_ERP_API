// Default HR document folder structure - transcribed from the provided handwritten
// planning notes (3 pages, folders A/2/3). Every section here is created as a GLOBAL
// DocumentSection (visible to every employee) by scripts/seedDocumentFolders.js.
//
// A section with `builtInKey` set means it maps onto one of the 10 pre-existing
// built-in document types (National ID, Birth Certificate, etc.) - the seed script
// creates a DocumentSection record with that exact key so it's properly organized
// under the right folder, while uploads still route to the same storage location as
// before (employmentDetails.documents, not customDocuments - see isBuiltInType() in
// hrController.js). Everything else is a brand new section with no prior storage.

const FOLDER_STRUCTURE = [
  {
    key: 'civil_status_file',
    label: 'Civil Status File',
    sections: [
      { builtInKey: 'nationalId', label: 'National ID (Certified Copy)', required: true },
      { builtInKey: 'birthCertificate', label: 'Birth Certificate of Immediate Family Members', required: true },
      { key: 'marriage_certificate', label: 'Photocopy of Marriage Certificate', required: false },
      { builtInKey: 'criminalRecord', label: 'Criminal Record', required: true }
    ]
  },
  {
    key: 'education_professional_training',
    label: 'Education and Professional Training',
    sections: [
      { builtInKey: 'academicDiplomas', label: 'Highest Academic Diplomas', required: true },
      { builtInKey: 'workCertificates', label: 'Work Certificate / Attestations', required: false },
      { key: 'training_certification', label: 'Training / Certification', required: false }
    ]
  },
  {
    key: 'contracts',
    label: 'Contracts',
    sections: [
      { builtInKey: 'employmentContract', label: 'Employment Contracts', required: true },
      { key: 'addendum', label: 'Addendum', required: false },
      { key: 'internal_memorandum', label: 'Internal Memorandum', required: false },
      { key: 'cv', label: 'CV', required: false },
      { key: 'contract_warning_suspension_letter', label: 'Warning Letter / Suspension Letter', required: false }
    ]
  },
  {
    key: 'bank_details',
    label: 'Bank Details',
    sections: [
      { builtInKey: 'bankAttestation', label: 'Bank Attestation', required: true },
      { key: 'loan_request', label: 'Loan Request', required: false },
      { key: 'advance_of_salary', label: 'Advance of Salary', required: false }
    ]
  },
  {
    key: 'health_and_insurance',
    label: 'Health and Insurance',
    sections: [
      { builtInKey: 'medicalCertificate', label: 'Medical Certificate', required: true },
      { key: 'medical_reimbursement_file', label: 'Medical Reimbursement File', required: false },
      { key: 'sick_leave', label: 'Sick Leave', required: false }
    ]
  },
  {
    key: 'leave_and_absence',
    label: 'Leave and Absence',
    sections: [
      { key: 'leave_request', label: 'Leave Request', required: false },
      { key: 'request_of_time_off', label: 'Request of Time Off', required: false }
    ]
  },
  {
    key: 'cnps',
    label: 'CNPS',
    sections: [
      { key: 'cnps_registration_number', label: 'CNPS Registration Number', required: true },
      { key: 'notice_of_employment', label: "Notice of Employment (Avis D'Embauche)", required: false },
      { key: 'notice_of_termination_cnps', label: "Notice of Termination (Cessation D'Embauche)", required: false }
    ]
  },
  {
    key: 'disciplinary',
    label: 'Disciplinary',
    sections: [
      { key: 'query_letters', label: 'Query Letters', required: false },
      { key: 'formal_notification', label: 'Formal Notification (Warning Letter; Suspension Letter)', required: false }
    ]
  },
  {
    key: 'policies',
    label: 'Policies',
    sections: [
      { key: 'confidentiality_nda', label: 'Confidentiality and Non-Disclosure Agreement', required: false }
    ]
  },
  {
    key: 'termination',
    label: 'Termination',
    sections: [
      { key: 'termination_letter_notice', label: 'Termination Letter / Notice', required: false },
      { key: 'resignation', label: 'Resignation', required: false },
      { key: 'cnps_notification', label: 'CNPS Notification', required: false },
      { key: 'termination_work_certificate', label: 'Work Certificate', required: false }
    ]
  },
  {
    key: 'others',
    label: 'Others',
    sections: [
      { key: 'tax_payer_number', label: 'Tax Payer Number', required: false },
      { builtInKey: 'references', label: 'References (3)', required: true },
      { builtInKey: 'locationPlan', label: 'Detailed Location Plan', required: true },
      { key: 'passport_size_photo', label: 'Passport Size Photo', required: false }
    ]
  }
];

module.exports = { FOLDER_STRUCTURE };
