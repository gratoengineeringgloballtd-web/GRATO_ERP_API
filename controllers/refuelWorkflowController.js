const RefuelWorkflow = require('../models/RefuelWorkflow');

// Start or resume a workflow
exports.startWorkflow = async (req, res) => {
  const { siteId, technicianId, taskId } = req.body;
  let workflow = await RefuelWorkflow.findOne({ siteId, technicianId, taskId });
  if (!workflow) {
    workflow = new RefuelWorkflow({
      siteId, technicianId, taskId, status: 'activated',
      history: [{ status: 'activated', timestamp: new Date() }],
    });
    await workflow.save();
  }
  res.json(workflow);
};

// Update status and append to history
exports.updateStatus = async (req, res) => {
  const { id } = req.params;
  const { status, meta } = req.body;
  const workflow = await RefuelWorkflow.findById(id);
  if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
  workflow.status = status;
  workflow.history.push({ status, timestamp: new Date(), meta });
  await workflow.save();
  res.json(workflow);
};

// Get workflow (with history)
exports.getWorkflow = async (req, res) => {
  const { id } = req.params;
  const workflow = await RefuelWorkflow.findById(id)
    .populate('siteId technicianId taskId');
  if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
  res.json(workflow);
};
