// ============================================================
// config/sddQuestions.js
// The canonical SDD question set derived from the PDF.
// Used to seed a new SDD record with blank answers.
// ============================================================

const SDD_SECTIONS = {

  // ── PART II: GENERAL INFORMATION ──────────────────────────────────────────
  general_info: {
    label: 'General information',
    questions: [
      { key: 'company_name',           text: 'Company name',                                       type: 'text',    required: true },
      { key: 'trading_name',           text: 'Trading name',                                       type: 'text',    required: false },
      { key: 'country',                text: 'Country',                                            type: 'text',    required: true },
      { key: 'state',                  text: 'State / province',                                   type: 'text',    required: false },
      { key: 'street_address',         text: 'Street address',                                     type: 'text',    required: true },
      { key: 'mailing_address',        text: 'Mailing address',                                    type: 'text',    required: false },
      { key: 'telephone',              text: 'Company telephone',                                  type: 'text',    required: true },
      { key: 'email',                  text: 'Company email',                                      type: 'email',   required: true },
      { key: 'contact_person_name',    text: 'Contact person name',                                type: 'text',    required: true },
      { key: 'contact_person_title',   text: 'Contact person title',                               type: 'text',    required: false },
      { key: 'contact_person_email',   text: 'Contact person email',                               type: 'email',   required: true },
      { key: 'ceo_id',                 text: 'ID / passport of CEO (attach)',                      type: 'file',    required: true,  scored: false },
      { key: 'company_profile',        text: 'Company profile (attach)',                           type: 'file',    required: true,  scored: false },
      { key: 'registration_date',      text: 'Registration date',                                  type: 'date',    required: true },
      { key: 'parent_company',         text: 'Parent company name (if applicable)',                type: 'text',    required: false },
      { key: 'is_subsidiary',          text: 'Is your company a subsidiary of another company?',   type: 'boolean', required: true,  scored: false },
      { key: 'subsidiary_docs',        text: 'If subsidiary: attach related file',                 type: 'file',    required: false, scored: false },
      { key: 'shareholders',           text: 'List of all shareholders (name, % owned, nationality, DOB)', type: 'textarea', required: true, scored: false },
      { key: 'wht_rate',               text: 'Withholding tax rate (%)',                           type: 'number',  required: true,  scored: false },
      { key: 'tax_authority',          text: 'Tax authority name',                                 type: 'text',    required: true,  scored: false },
      { key: 'business_type',          text: 'Type of business (private/JV/corporation/partnership/govt/other)', type: 'select', required: true,
        options: ['privately_held','joint_venture','corporation','partnership','government','other'] },
      { key: 'authorised_directors',   text: 'Directors authorised to enter into contracts (name, title, contact)', type: 'textarea', required: true, scored: false },
      { key: 'top_five_clients',       text: 'Names of top five clients',                          type: 'textarea', required: false, scored: false }
    ]
  },

  // ── PART II: LEGAL & REGULATORY ───────────────────────────────────────────
  legal_regulatory: {
    label: 'Legal & regulatory',
    questions: [
      { key: 'cert_of_incorporation',     text: 'Certificate of incorporation (attach)',            type: 'file',    required: true,  scored: true },
      { key: 'articles_of_association',   text: 'Articles of association (attach)',                 type: 'file',    required: true,  scored: true },
      { key: 'tax_identification',        text: 'Tax identification number / certificate (attach)', type: 'file',    required: true,  scored: true },
      { key: 'tax_clearance',             text: 'Company tax clearance certificate (attach)',       type: 'file',    required: true,  scored: true },
      { key: 'bank_attestation',          text: 'Bank attestation letter (attach)',                 type: 'file',    required: true,  scored: true },
      { key: 'operating_licence',         text: 'Operating licence issued by appropriate authority (attach)', type: 'file', required: false, scored: true },
      { key: 'iso_certifications',        text: 'ISO certifications held (attach)',                 type: 'file',    required: false, scored: true },
      { key: 'environmental_cert',        text: 'Environmental certifications (attach)',            type: 'file',    required: false, scored: true },
      { key: 'periodic_review_cycle',     text: 'Document review cycle in place?',                 type: 'boolean', required: true,  scored: true }
    ]
  },

  // ── PART II: TECHNICAL EVALUATION ─────────────────────────────────────────
  technical_evaluation: {
    label: 'Technical evaluation',
    questions: [
      { key: 'evaluation_template',       text: 'Evaluation template (attach)',                    type: 'file',    required: true,  scored: false },
      { key: 'team_cvs',                  text: 'CVs of execution team members (attach)',          type: 'file',    required: true,  scored: true },
      { key: 'signed_organogram',         text: 'Signed organogram (attach)',                     type: 'file',    required: true,  scored: true },
      { key: 'unmet_critical_points',     text: 'List any unmet critical requirements',            type: 'textarea',required: false, scored: false }
    ]
  },

  // ── PART II: BUSINESS GOVERNANCE ──────────────────────────────────────────
  governance: {
    label: 'Business governance',
    questions: [
      { key: 'env_management_system',   text: 'Do you have a documented environmental management system?', type: 'boolean', required: true, scored: true },
      { key: 'risk_assessment_process', text: 'Do you have a formal process for workplace risk assessment?', type: 'boolean', required: true, scored: true },
      { key: 'employee_training',       text: 'Do you provide communication and training to employees on compliance?', type: 'boolean', required: true, scored: true },
      { key: 'audit_process',           text: 'Do you conduct compliance audits?',                type: 'boolean', required: true, scored: true },
      { key: 'cybersecurity_staff',     text: 'Do you have dedicated staff for cybersecurity alerts?', type: 'boolean', required: true, scored: true },
      { key: 'business_continuity',     text: 'Do you have a documented business continuity plan?', type: 'boolean', required: true, scored: true },
      { key: 'antibribery_policy',      text: 'Do you have a policy statement and controls for local and anti-bribery laws?', type: 'boolean', required: true, scored: true },
      { key: 'antibribery_doc',         text: 'Anti-bribery policy document (attach)',            type: 'file',    required: false, scored: true },
      { key: 'data_protection_policy',  text: 'Do you have a policy for protection of personal/sensitive information?', type: 'boolean', required: true, scored: true },
      { key: 'data_protection_doc',     text: 'Data protection policy document (attach)',         type: 'file',    required: false, scored: true },
      { key: 'human_rights_policy',     text: 'Do you have a policy concerning human rights, labour rights, anti-slavery?', type: 'boolean', required: true, scored: true },
      { key: 'human_rights_doc',        text: 'Human rights policy document (attach)',            type: 'file',    required: false, scored: true },
      { key: 'iso_certificates',        text: 'ISO certifications held (attach)',                 type: 'file',    required: false, scored: true },
      { key: 'environmental_cert_gov',  text: 'Environmental certifications (attach)',            type: 'file',    required: false, scored: true }
    ]
  },

  // ── PART II: HSSE — QUALITY ASSURANCE ─────────────────────────────────────
  'hsse.quality_assurance': {
    label: 'HSSE — Quality assurance',
    questions: [
      { key: 'iso_9001',          text: 'Is your company certified ISO 9001? (attach certificate)', type: 'boolean', required: true, scored: true },
      { key: 'quality_policy',    text: 'Do you have a written quality policy? (attach copy)',    type: 'boolean', required: true, scored: true },
      { key: 'quality_responsible', text: 'Is there a person responsible for quality matters? (name and position)', type: 'text', required: false, scored: true },
      { key: 'quality_manual',    text: 'Do you have a written quality/QHSE manual or procedures? (attach)', type: 'boolean', required: true, scored: true },
      { key: 'quality_audit_procedure', text: 'Do you have a documented procedure for quality audits? (attach)', type: 'boolean', required: true, scored: true },
      { key: 'quality_audit_plan', text: 'Do you have a quality audit plan? (attach)',            type: 'boolean', required: true, scored: true },
      { key: 'quality_audits_conducted', text: 'Have you conducted quality internal and external audits? (attach last record)', type: 'boolean', required: true, scored: true }
    ]
  },

  // ── PART II: HSSE — HSE POLICY ────────────────────────────────────────────
  'hsse.hse_policy': {
    label: 'HSSE — HSE policy & management',
    questions: [
      { key: 'oshas_18001',       text: 'Is your company certified OSHAS 18001? (attach)',        type: 'boolean', required: true, scored: true },
      { key: 'hse_policy',        text: 'Do you have a written HSE policy? (attach)',             type: 'boolean', required: true, scored: true },
      { key: 'hse_manual',        text: 'Do you have a written HSE manual or procedures? (attach)', type: 'boolean', required: true, scored: true },
      { key: 'hse_audit_plan',    text: 'Do you have a HSE audit plan? (attach)',                 type: 'boolean', required: true, scored: true },
      { key: 'hse_audits',        text: 'Have you conducted HSE internal and external audits? (attach last record)', type: 'boolean', required: true, scored: true },
      { key: 'hse_committee',     text: 'Do you have a HSE committee? (attach org chart and last MOM)', type: 'boolean', required: true, scored: true },
      { key: 'hse_committee_frequency', text: 'HSE committee meeting frequency',                 type: 'text',    required: false, scored: false },
      { key: 'safety_officer',    text: 'Do you have a certified Safety & Health Officer registered with DOSH? (attach competency record)', type: 'boolean', required: true, scored: true },
      { key: 'hirarc_jsa',        text: 'Do you have a written HIRARC/JSA procedure and trained employees? (attach)', type: 'boolean', required: true, scored: true },
      { key: 'hse_program',       text: 'Do you have a HSE program or HSE Day at your facility? (attach evidence)', type: 'boolean', required: false, scored: true },
      { key: 'legal_register',    text: 'Do you identify, maintain and implement legal/statutory requirements? (attach legal register)', type: 'boolean', required: true, scored: true },
      { key: 'health_surveillance', text: 'Do you conduct health surveillance for all employees? (attach latest plan/record)', type: 'boolean', required: true, scored: true },
      { key: 'ppe_helmets',       text: 'Do you provide safety helmets?',                         type: 'boolean', required: true, scored: true },
      { key: 'ppe_shoes',         text: 'Do you provide safety shoes?',                           type: 'boolean', required: true, scored: true },
      { key: 'ppe_harness',       text: 'Do you provide safety harness?',                         type: 'boolean', required: true, scored: true },
      { key: 'ppe_eye',           text: 'Do you provide eye protection?',                         type: 'boolean', required: true, scored: true },
      { key: 'ppe_ear',           text: 'Do you provide ear protection?',                         type: 'boolean', required: true, scored: true },
      { key: 'ppe_mask',          text: 'Do you provide face masks?',                             type: 'boolean', required: true, scored: true },
      { key: 'ppe_coverall',      text: 'Do you provide coveralls?',                              type: 'boolean', required: true, scored: true },
      { key: 'ppe_record',        text: 'PPE issuance record (attach)',                           type: 'file',    required: false, scored: true },
      { key: 'incident_procedure', text: 'Do you have an incident investigation procedure? (attach)', type: 'boolean', required: true, scored: true }
    ]
  },

  // ── PART II: HSSE — SAFETY PERFORMANCE ────────────────────────────────────
  'hsse.safety_performance': {
    label: 'HSSE — Safety performance indicators',
    questions: [
      { key: 'hse_training',      text: 'Do you provide HSE training? (attach last record)',       type: 'boolean', required: true, scored: true },
      { key: 'new_employee_hse',  text: 'What arrangements ensure new employees have basic industrial HSE knowledge? (attach evidence)', type: 'textarea', required: true, scored: false },
      { key: 'scheduled_waste',   text: 'Do you have competent persons for handling scheduled wastes (CePSWAM)? (attach)', type: 'boolean', required: false, scored: true },
      { key: 'fatalities_y1',     text: 'Number of fatalities — year 1',                          type: 'number',  required: true, scored: false },
      { key: 'fatalities_y2',     text: 'Number of fatalities — year 2',                          type: 'number',  required: true, scored: false },
      { key: 'fatalities_y3',     text: 'Number of fatalities — year 3',                          type: 'number',  required: true, scored: false },
      { key: 'lti_y1',            text: 'Number of Lost Time Injuries — year 1',                  type: 'number',  required: true, scored: false },
      { key: 'lti_y2',            text: 'Number of Lost Time Injuries — year 2',                  type: 'number',  required: true, scored: false },
      { key: 'lti_y3',            text: 'Number of Lost Time Injuries — year 3',                  type: 'number',  required: true, scored: false },
      { key: 'near_misses_y1',    text: 'Number of near miss occurrences — year 1',               type: 'number',  required: true, scored: false },
      { key: 'near_misses_y2',    text: 'Number of near miss occurrences — year 2',               type: 'number',  required: true, scored: false },
      { key: 'near_misses_y3',    text: 'Number of near miss occurrences — year 3',               type: 'number',  required: true, scored: false },
      { key: 'trcf_y1',           text: 'TRCF — year 1',                                          type: 'number',  required: false, scored: false },
      { key: 'ltif_y1',           text: 'LTIF — year 1',                                          type: 'number',  required: false, scored: false }
    ]
  },

  // ── PART II: HSSE — ENVIRONMENTAL ─────────────────────────────────────────
  'hsse.environmental': {
    label: 'HSSE — Environmental',
    questions: [
      { key: 'iso_14001',         text: 'Is your company certified ISO 14001? (attach)',           type: 'boolean', required: true, scored: true },
      { key: 'env_policy',        text: 'Do you have an environmental policy? (attach)',           type: 'boolean', required: true, scored: true },
      { key: 'scheduled_waste_proc', text: 'Do you have a scheduled wastes management procedure? (attach)', type: 'boolean', required: true, scored: true },
      { key: 'env_audit_plan',    text: 'Do you have an environmental audit plan? (attach)',       type: 'boolean', required: true, scored: true },
      { key: 'env_audits',        text: 'Have you conducted environmental internal and external audits? (attach last record)', type: 'boolean', required: true, scored: true },
      { key: 'env_non_compliance', text: 'Have there been environmental non-compliance issues in the last 3 years? (attach NC notice)', type: 'boolean', required: true, scored: true },
      { key: 'spill_procedure',   text: 'Do you have a documented procedure to prevent spill/leak incidents? (attach)', type: 'boolean', required: true, scored: true },
      { key: 'env_committee',     text: 'Do you conduct Environmental Planning & Monitoring Committee meetings? (attach org chart and last MOM)', type: 'boolean', required: true, scored: true },
      { key: 'ghg_monitoring',    text: 'Does your company monitor GHG emissions? (attach evidence)', type: 'boolean', required: false, scored: true },
      { key: 'env_program',       text: 'Do you have an environmental program or Environmental Day at your facility? (attach evidence)', type: 'boolean', required: false, scored: true }
    ]
  },

  // ── PART II: HSSE — EMERGENCY PREPAREDNESS ────────────────────────────────
  'hsse.emergency': {
    label: 'HSSE — Emergency preparedness & response',
    questions: [
      { key: 'emergency_plan',    text: 'What arrangements do you have for emergency preparedness and response? (attach evidence)', type: 'textarea', required: true, scored: false },
      { key: 'ert_onsite',        text: 'Is an on-site Emergency Response Team (ERT) available at all facilities? (attach establishment doc)', type: 'boolean', required: true, scored: true },
      { key: 'erp_ghs_available', text: 'Is the Emergency Response Plan / GHS available at storage areas? (attach evidence)', type: 'boolean', required: true, scored: true }
    ]
  }
};

// Helper: build blank answer array from the question template
function buildBlankAnswers() {
  const answers = [];
  Object.entries(SDD_SECTIONS).forEach(([sectionKey, section]) => {
    section.questions.forEach(q => {
      answers.push({
        sectionKey,
        questionKey:  q.key,
        questionText: q.text,
        answer:       null,
        answerText:   '',
        notApplicable: false,
        attachments:  [],
        score:        0,
        flagged:      false
      });
    });
  });
  return answers;
}

module.exports = { SDD_SECTIONS, buildBlankAnswers };