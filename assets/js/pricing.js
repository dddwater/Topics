// VibeSpace Interactive ROI Calculator & Pricing Script (Fixed & Refined)

document.addEventListener('DOMContentLoaded', () => {
  // Input Elements
  const empSlider = document.getElementById('empCountSlider');
  const empInput = document.getElementById('empCountInput');
  const empCountVal = document.getElementById('empCountVal');

  const salarySlider = document.getElementById('avgSalarySlider');
  const salaryInput = document.getElementById('avgSalaryInput');
  const avgSalaryVal = document.getElementById('avgSalaryVal');

  const boostSlider = document.getElementById('boostSlider');
  const boostDisplay = document.getElementById('boostDisplay');

  // Plan Select Dropdown
  const planSelect = document.getElementById('planSelect');

  // Metric Output Elements
  const outMonthlyPayroll = document.getElementById('outMonthlyPayroll');
  const outMonthlyGain = document.getElementById('outMonthlyGain');
  const outAnnualGain = document.getElementById('outAnnualGain');
  const outROI = document.getElementById('outROI');
  const outPaybackDays = document.getElementById('outPaybackDays');
  const progressBarFill = document.getElementById('progressBarFill');
  const progressText = document.getElementById('progressText');

  // Toggle Billing Elements
  const btnMonthly = document.getElementById('btnMonthly');
  const btnYearly = document.getElementById('btnYearly');
  const priceNums = document.querySelectorAll('.price-num');
  const priceUnits = document.querySelectorAll('.price-unit');

  let isYearly = false;

  // Realistic SaaS Plan Monthly Rates in NTD
  const planPricesMonthly = {
    starter: 299,
    pro: 990,
    enterprise: 2990
  };

  // Sync Input & Sliders + Update Display Values (Fixed Live Text Bug)
  function setupInputs() {
    // Employee count sync
    const updateEmp = () => {
      const val = parseInt(empInput.value) || 0;
      empCountVal.textContent = val.toLocaleString() + ' 人';
      calculateROI();
    };

    empSlider.addEventListener('input', () => {
      empInput.value = empSlider.value;
      updateEmp();
    });

    empInput.addEventListener('input', () => {
      let val = parseInt(empInput.value) || 1;
      val = Math.max(1, Math.min(200, val));
      empSlider.value = val;
      updateEmp();
    });

    // Salary sync
    const updateSalary = () => {
      const val = parseInt(salaryInput.value) || 0;
      avgSalaryVal.textContent = 'NT$ ' + val.toLocaleString();
      calculateROI();
    };

    salarySlider.addEventListener('input', () => {
      salaryInput.value = salarySlider.value;
      updateSalary();
    });

    salaryInput.addEventListener('input', () => {
      let val = parseInt(salaryInput.value) || 30000;
      val = Math.max(20000, Math.min(200000, val));
      salarySlider.value = val;
      updateSalary();
    });

    // Boost Slider
    boostSlider.addEventListener('input', () => {
      boostDisplay.textContent = boostSlider.value + '%';
      calculateROI();
    });

    planSelect.addEventListener('change', calculateROI);
  }

  // Main Financial Calculation
  function calculateROI() {
    const empCount = parseInt(empInput.value) || 0;
    const avgSalary = parseInt(salaryInput.value) || 0;
    const boostPct = (parseFloat(boostSlider.value) || 5) / 100;

    // 1. Total Monthly Payroll (團隊月薪總額)
    const totalMonthlySalary = empCount * avgSalary;

    // 2. Monthly Productivity Gain (預估月提升產值 = 總薪資 * 提升率)
    const monthlyGain = Math.round(totalMonthlySalary * boostPct);
    const annualGain = monthlyGain * 12;

    // 3. Selected Plan Monthly & Annual Subscription Fee
    const planKey = planSelect.value;
    const monthlyPlanCost = planPricesMonthly[planKey] || 990;
    const annualPlanCost = monthlyPlanCost * 12;

    // 4. Annual Net Value & ROI Calculation
    const annualNetGain = annualGain - annualPlanCost;
    const monthlyNetGain = monthlyGain - monthlyPlanCost;

    let roiPercentage = 0;
    if (annualPlanCost > 0) {
      roiPercentage = Math.round((annualNetGain / annualPlanCost) * 100);
    }

    // 5. Payback Days Calculation (回收期計算)
    let paybackText = '';
    if (monthlyNetGain <= 0) {
      paybackText = '未達規模 (產值不敷訂閱費)';
    } else {
      // Days in first month to earn back monthly subscription
      const dailyGain = monthlyGain / 30;
      const days = Math.ceil(monthlyPlanCost / dailyGain);
      if (days <= 1) {
        paybackText = '開工第 1 天即回收當月成本';
      } else if (days <= 30) {
        paybackText = `開工第 ${days} 天即回收當月成本`;
      } else {
        const months = (monthlyPlanCost / monthlyGain).toFixed(1);
        paybackText = `約 ${months} 個月回收成本`;
      }
    }

    // Render Text Outputs with compact formatting
    outMonthlyPayroll.textContent = 'NT$ ' + totalMonthlySalary.toLocaleString();
    outMonthlyGain.textContent = 'NT$ ' + monthlyGain.toLocaleString();
    
    // Net Gain styling (negative vs positive)
    if (annualNetGain < 0) {
      outAnnualGain.textContent = '- NT$ ' + Math.abs(annualNetGain).toLocaleString();
      outAnnualGain.classList.add('negative');
    } else {
      outAnnualGain.textContent = 'NT$ ' + annualNetGain.toLocaleString();
      outAnnualGain.classList.remove('negative');
    }

    // ROI Percentage styling
    if (roiPercentage < 0) {
      outROI.textContent = roiPercentage + '%';
      outROI.classList.add('negative');
    } else {
      outROI.textContent = '+' + roiPercentage + '%';
      outROI.classList.remove('negative');
    }

    outPaybackDays.textContent = paybackText;

    // Progress Bar Ratio Calculation (Proportion of Productivity Gain vs Subscription Cost)
    let ratio = 0;
    if (monthlyGain + monthlyPlanCost > 0) {
      ratio = Math.round((monthlyGain / (monthlyGain + monthlyPlanCost)) * 100);
    }
    ratio = Math.max(0, Math.min(100, ratio));
    progressBarFill.style.width = ratio + '%';
    progressText.textContent = `產值價值 (NT$ ${monthlyGain.toLocaleString()}) vs 系統月費 (NT$ ${monthlyPlanCost.toLocaleString()})`;
  }

  // Toggle Billing Cycle (Monthly / Yearly)
  btnMonthly.addEventListener('click', () => {
    isYearly = false;
    btnMonthly.classList.add('active');
    btnYearly.classList.remove('active');
    updatePricingCards();
  });

  btnYearly.addEventListener('click', () => {
    isYearly = true;
    btnYearly.classList.add('active');
    btnMonthly.classList.remove('active');
    updatePricingCards();
  });

  function updatePricingCards() {
    priceNums.forEach(el => {
      const plan = el.dataset.plan;
      let monthlyRate = planPricesMonthly[plan];
      if (isYearly) {
        // 20% discount for annual billing
        const yearlyDiscountedMonthly = Math.round(monthlyRate * 0.8);
        el.textContent = yearlyDiscountedMonthly.toLocaleString();
      } else {
        el.textContent = monthlyRate.toLocaleString();
      }
    });

    priceUnits.forEach(el => {
      el.textContent = isYearly ? '/ 月 (按年計費)' : '/ 月';
    });

    calculateROI();
  }

  // Initialize
  setupInputs();
  calculateROI();
});
