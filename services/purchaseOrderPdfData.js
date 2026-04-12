const buildPurchaseOrderPdfData = (purchaseOrder) => {
  const safeNumber = (value, defaultValue = 0) => {
    if (value === null || value === undefined || value === '') {
      return defaultValue;
    }
    const num = Number(value);
    return Number.isNaN(num) ? defaultValue : num;
  };

  const supplierSnapshot = purchaseOrder.supplierDetails || {};
  const supplierUserDetails = purchaseOrder.supplierId?.supplierDetails || {};

  const taxApplicable = Boolean(purchaseOrder.taxApplicable);
  const taxRate = safeNumber(purchaseOrder.taxRate, 0);
  const totalAmount = safeNumber(purchaseOrder.totalAmount, 0);
  const taxAmount = safeNumber(purchaseOrder.taxAmount, 0);

  let subtotalAmount = safeNumber(purchaseOrder.subtotalAmount, 0);
  if (subtotalAmount === 0 && totalAmount > 0) {
    if (taxApplicable && taxRate > 0) {
      subtotalAmount = totalAmount - taxAmount;
    } else {
      subtotalAmount = totalAmount;
    }
  }

  return {
    id: purchaseOrder._id,
    poNumber: purchaseOrder.poNumber,
    requisitionId: purchaseOrder.requisitionId?._id,
    requisitionTitle: purchaseOrder.requisitionId?.title,
    supplierDetails: {
      name: supplierSnapshot.name || supplierUserDetails.companyName || purchaseOrder.supplierId?.fullName,
      email: supplierSnapshot.email || purchaseOrder.supplierId?.email,
      phone: supplierSnapshot.phone || purchaseOrder.supplierId?.phone,
      address: supplierSnapshot.address || supplierUserDetails.address,
      businessType: supplierSnapshot.businessType || supplierUserDetails.businessType
    },
    creationDate: purchaseOrder.createdAt,
    expectedDeliveryDate: purchaseOrder.expectedDeliveryDate,
    actualDeliveryDate: purchaseOrder.actualDeliveryDate,
    status: purchaseOrder.status,
    totalAmount: totalAmount,
    subtotalAmount: subtotalAmount,
    taxApplicable: taxApplicable,
    taxRate: taxRate,
    taxAmount: taxAmount,
    currency: purchaseOrder.currency || 'XAF',
    paymentTerms: purchaseOrder.paymentTerms,
    deliveryAddress: purchaseOrder.deliveryAddress,
    deliveryTerms: purchaseOrder.deliveryTerms,
    items: (purchaseOrder.items || []).map(item => {
      const quantity = safeNumber(item.quantity, 0);
      const unitPrice = safeNumber(item.unitPrice, 0);
      const totalPrice = safeNumber(item.totalPrice, quantity * unitPrice);
      const discount = safeNumber(item.discount, 0);

      return {
        description: item.description || 'No description',
        quantity: quantity,
        unitPrice: unitPrice,
        totalPrice: totalPrice,
        discount: discount,
        specifications: item.specifications,
        itemCode: item.itemCode || (item.itemId ? item.itemId.code : ''),
        category: item.category || (item.itemId ? item.itemId.category : ''),
        unitOfMeasure: item.unitOfMeasure || (item.itemId ? item.itemId.unitOfMeasure : 'Units')
      };
    }),
    specialInstructions: purchaseOrder.specialInstructions || '',
    notes: purchaseOrder.notes || '',
    termsAndConditions: purchaseOrder.termsAndConditions || '',
    progress: purchaseOrder.progress,
    currentStage: purchaseOrder.currentStage,
    activities: purchaseOrder.activities || [],
    supplierName: supplierSnapshot.name || supplierUserDetails.companyName || purchaseOrder.supplierId?.fullName || 'Unknown Supplier',
    supplierEmail: supplierSnapshot.email || purchaseOrder.supplierId?.email || '',
    supplierPhone: supplierSnapshot.phone || purchaseOrder.supplierId?.phone || ''
  };
};

module.exports = {
  buildPurchaseOrderPdfData
};
