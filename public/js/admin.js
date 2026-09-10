/**
 * Traxen Admin Command Center - Frontend Logic
 * Full Vehicle Management, User Management, License Control, and Assignment Hub
 */

const AdminApp = {
  activeTab: 'vehicles',
  selectedVehicleType: 'CAR',
  selectedSimProvider: 'Airtel',
  selectedProtocol: 'Teltonika Codec 8 Extended',
  selectedLicenseOption: 'preset', // 'preset', 'pool', 'none'
  selectedPresetDays: 365,
  selectedUserIds: new Set(),
  editVehicleId: null,
  editUserId: null,

  // Vehicle Types Definitions
  vehicleTypes: [
    { id: 'CAR', label: 'Car', icon: '🚗' },
    { id: 'CAR. SUV', label: 'SUV / MUV', icon: '🚙' },
    { id: 'BIKE', label: 'Bike / Scooter', icon: '🏍️' },
    { id: 'BUS', label: 'Bus / Coach', icon: '🚌' },
    { id: 'MINI TRUCK', label: 'Mini Truck', icon: '🛻' },
    { id: 'OPEN TRUCK', label: 'Open Truck', icon: '🚛' },
    { id: 'CONTAINER', label: 'Container', icon: '🚚' },
    { id: 'BULKER', label: 'Bulker / Tanker', icon: '⛽' },
    { id: 'TRACTOR', label: 'Tractor', icon: '🚜' },
    { id: 'AUTO-RICKSHAW', label: 'Auto Rickshaw', icon: '🛺' },
    { id: 'AMBULANCE', label: 'Ambulance', icon: '🚑' },
    { id: 'PORTABLE TRACKER', label: 'Asset / Portable', icon: '📦' }
  ],

  simProviders: [
    { id: 'Airtel', label: 'Airtel IoT', color: '#ff2d55' },
    { id: 'Jio', label: 'Jio 4G/5G', color: '#007aff' },
    { id: 'Vi', label: 'Vi Business', color: '#af52de' },
    { id: 'BSNL', label: 'BSNL M2M', color: '#34c759' }
  ],

  licensePresets: [
    { label: '6 Months', days: 180, tag: 'Standard' },
    { label: '1 Year', days: 365, tag: 'Most Popular' },
    { label: '2 Years', days: 730, tag: 'Value Pack' },
    { label: '3 Years', days: 1095, tag: 'Enterprise' }
  ],

  init() {
    this.bindEvents();
    this.renderVehicleTypePicker();
    this.renderSimProviderPicker();
    this.renderLicensePresets();
  },

  bindEvents() {
    // Top Tab switching
    document.querySelectorAll('.admin-nav-tab').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = btn.dataset.tab;
        this.switchTab(tab);
      });
    });

    // Vehicle Search & Filters
    const vSearch = document.getElementById('adminVehicleSearch');
    if (vSearch) {
      vSearch.addEventListener('input', () => this.loadVehicles());
    }
    const vStatus = document.getElementById('adminVehicleStatusFilter');
    if (vStatus) {
      vStatus.addEventListener('change', () => this.loadVehicles());
    }

    // User Search & Filters
    const uSearch = document.getElementById('adminUserSearch');
    if (uSearch) {
      uSearch.addEventListener('input', () => this.loadUsers());
    }
    const uRole = document.getElementById('adminUserRoleFilter');
    if (uRole) {
      uRole.addEventListener('change', () => this.loadUsers());
    }

    // License Filter
    const lStatus = document.getElementById('adminLicenseStatusFilter');
    if (lStatus) {
      lStatus.addEventListener('change', () => this.loadLicenses());
    }
  },

  openAdminModal(initialTab = 'vehicles') {
    const modal = document.getElementById('adminCommandModal');
    if (!modal) return;
    modal.classList.add('active');
    this.switchTab(initialTab);
    this.loadStats();
  },

  closeAdminModal() {
    const modal = document.getElementById('adminCommandModal');
    if (modal) modal.classList.remove('active');
  },

  switchTab(tab) {
    this.activeTab = tab;
    document.querySelectorAll('.admin-nav-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    document.querySelectorAll('.admin-tab-pane').forEach(p => {
      p.classList.toggle('active', p.id === `adminPane_${tab}`);
    });

    if (tab === 'vehicles') this.loadVehicles();
    else if (tab === 'users') this.loadUsers();
    else if (tab === 'licenses') this.loadLicenses();
    else if (tab === 'stats') this.loadStats();
  },

  // -------------------------------------------------------------
  // STATS & KPI OVERVIEW
  // -------------------------------------------------------------
  async loadStats() {
    try {
      const res = await fetch('/api/admin/stats');
      const json = await res.json();
      if (!json.success) return;
      const d = json.data;

      const setEl = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val !== undefined ? val : '0';
      };

      setEl('statTotalVehicles', d.totalVehicles);
      setEl('statOnlineVehicles', d.onlineVehicles);
      setEl('statMovingVehicles', d.movingVehicles);
      setEl('statIdleVehicles', d.idleVehicles);
      setEl('statOfflineVehicles', d.offlineVehicles);

      setEl('statTotalUsers', d.totalUsers);
      setEl('statAdmins', d.adminCount);
      setEl('statDealers', d.dealerCount);
      setEl('statCustomers', d.customerCount);

      setEl('statTotalLicenses', d.totalLicenses);
      setEl('statActiveLicenses', d.activeLicenses);
      setEl('statAvailableLicenses', d.availableLicenses);

      // Render type breakdown
      const typeGrid = document.getElementById('adminVehicleTypeStatsGrid');
      if (typeGrid && d.vehicleTypeCounts) {
        typeGrid.innerHTML = Object.entries(d.vehicleTypeCounts).map(([type, count]) => {
          const typeDef = this.vehicleTypes.find(t => t.id === type) || { label: type, icon: '🚗' };
          return `
            <div class="stat-type-pill">
              <span class="type-icon">${typeDef.icon}</span>
              <span class="type-name">${typeDef.label}</span>
              <span class="type-count">${count}</span>
            </div>
          `;
        }).join('');
      }
      // Fetch Database & 90-Day CAN Storage Stats
      try {
        const dbRes = await fetch('/api/admin/database/stats');
        const dbJson = await dbRes.json();
        if (dbJson.success && dbJson.data) {
          const dbData = dbJson.data;
          setEl('statDbRecords', dbData.totalCanTelemetryRecords?.toLocaleString() || '0');
          setEl('statDbSize', dbData.totalDatabaseSizeMb || '0 MB');
          setEl('statDbRetention', dbData.retentionPolicy || '90 Days (3 Months)');
          setEl('statDbActiveTracked', dbData.activeDevicesTracked || '0');
        }
      } catch (dbErr) {
        console.warn('[Admin] Failed to load DB stats:', dbErr);
      }
    } catch (err) {
      console.error('[Admin] Error loading stats:', err);
    }
  },

  async runDatabaseMaintenance() {
    if (!confirm('Run 90-day retention cleanup and WAL optimization now?')) return;
    try {
      const res = await fetch('/api/admin/database/maintenance', { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        alert(`Database Maintenance Completed:\n- Purged > 90-day records: ${json.data.purgedRecords}\n- Database Size: ${json.data.databaseSizeMb}`);
        this.loadStats();
      } else {
        alert('Failed to run maintenance: ' + (json.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Maintenance error: ' + err.message);
    }
  },

  // -------------------------------------------------------------
  // VEHICLE MANAGEMENT
  // -------------------------------------------------------------
  async loadVehicles() {
    const tableBody = document.getElementById('adminVehiclesTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = `<tr><td colspan="7" class="loading-cell"><div class="spinner"></div> Loading vehicles...</td></tr>`;

    const search = document.getElementById('adminVehicleSearch')?.value || '';
    const status = document.getElementById('adminVehicleStatusFilter')?.value || '';

    try {
      const res = await fetch(`/api/admin/vehicles?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}&limit=100`);
      const json = await res.json();
      if (!json.success || !json.vehicles || json.vehicles.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" class="empty-cell">No vehicles found matching criteria. Click "+ Add Vehicle" to register one.</td></tr>`;
        return;
      }

      tableBody.innerHTML = json.vehicles.map(v => {
        const typeDef = this.vehicleTypes.find(t => t.id === v.vehicleType) || { label: v.vehicleType || 'Car', icon: '🚗' };
        const simDef = this.simProviders.find(s => s.id === v.simProvider) || { label: v.simProvider || 'Airtel', color: '#ff2d55' };
        
        let licenseBadge = `<span class="badge badge-gray">No License</span>`;
        if (v.license) {
          const expiresAt = v.license.expiresAt ? new Date(v.license.expiresAt) : null;
          const daysLeft = expiresAt ? Math.round((expiresAt - Date.now()) / (1000 * 3600 * 24)) : null;
          if (daysLeft !== null && daysLeft > 15) {
            licenseBadge = `<span class="badge badge-green" title="Expires: ${expiresAt.toLocaleDateString()}">Active (${daysLeft}d left)</span>`;
          } else if (daysLeft !== null && daysLeft > 0) {
            licenseBadge = `<span class="badge badge-orange" title="Expires: ${expiresAt.toLocaleDateString()}">Expiring (${daysLeft}d left)</span>`;
          } else if (daysLeft !== null) {
            licenseBadge = `<span class="badge badge-red" title="Expired: ${expiresAt.toLocaleDateString()}">Expired</span>`;
          } else {
            licenseBadge = `<span class="badge badge-green">${v.license.status || 'Active'}</span>`;
          }
        }

        const isOnline = v.status === 'ONLINE';
        const isMoving = isOnline && v.lastTelemetry && v.lastTelemetry.speed > 0;
        const isIdle = isOnline && v.lastTelemetry && v.lastTelemetry.speed === 0 && v.lastTelemetry.ignition;
        let statusBadge = `<span class="status-pill status-offline"><span class="dot"></span> OFFLINE</span>`;
        if (isMoving) statusBadge = `<span class="status-pill status-moving"><span class="dot"></span> MOVING (${v.lastTelemetry.speed} km/h)</span>`;
        else if (isIdle) statusBadge = `<span class="status-pill status-idle"><span class="dot"></span> IDLE (Ignition ON)</span>`;
        else if (isOnline) statusBadge = `<span class="status-pill status-online"><span class="dot"></span> ONLINE</span>`;

        const userChips = (v.assignedUsers || []).map(u => `<span class="user-chip" title="${u.role}">${u.name}</span>`).join(' ') || '<span class="text-muted">Unassigned</span>';

        return `
          <tr data-imei="${v.imei}">
            <td class="vehicle-plate-cell">
              <div class="plate-box">
                <span class="type-icon">${typeDef.icon}</span>
                <div>
                  <div class="plate-number">${v.numberPlate || v.registrationNumber || v.vehicleNumber}</div>
                  <div class="type-label">${typeDef.label}</div>
                </div>
              </div>
            </td>
            <td>
              <div class="mono-text">${v.imei}</div>
              <div class="protocol-sub">${v.protocol || 'Teltonika Codec 8 Ext'}</div>
            </td>
            <td>
              <div class="sim-cell">
                <span class="sim-provider-badge" style="background: ${simDef.color}20; color: ${simDef.color}; border: 1px solid ${simDef.color}50;">${simDef.label}</span>
                <span class="mono-text">${v.simNumber || '—'}</span>
              </div>
            </td>
            <td>${licenseBadge}</td>
            <td><div class="user-chips-wrap">${userChips}</div></td>
            <td>${statusBadge}</td>
            <td class="actions-cell">
              <button class="btn-action-icon" title="Track Live" onclick="AdminApp.trackVehicle('${v.imei}')">🛰️</button>
              <button class="btn-action-icon" title="Edit Vehicle" onclick="AdminApp.openEditVehicleModal('${v.imei}')">✏️</button>
              <button class="btn-action-icon" title="Assign Users" onclick="AdminApp.openAssignUsersModal('${v.imei}')">👥</button>
              <button class="btn-action-icon" title="Renew License" onclick="AdminApp.openRenewLicenseModal('${v.imei}')">⚡</button>
              <button class="btn-action-icon btn-danger" title="Delete Vehicle" onclick="AdminApp.deleteVehicle('${v.imei}')">🗑️</button>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      tableBody.innerHTML = `<tr><td colspan="7" class="error-cell">Failed to load vehicles: ${err.message}</td></tr>`;
    }
  },

  trackVehicle(imei) {
    this.closeAdminModal();
    const select = document.getElementById('deviceSelect');
    if (select) {
      select.value = imei;
      select.dispatchEvent(new Event('change'));
    }
  },

  renderVehicleTypePicker() {
    const grid = document.getElementById('vehicleTypePickerGrid');
    if (!grid) return;
    grid.innerHTML = this.vehicleTypes.map(t => `
      <div class="type-pick-card ${this.selectedVehicleType === t.id ? 'selected' : ''}" onclick="AdminApp.selectVehicleType('${t.id}')">
        <div class="type-icon">${t.icon}</div>
        <div class="type-label">${t.label}</div>
      </div>
    `).join('');
  },

  selectVehicleType(typeId) {
    this.selectedVehicleType = typeId;
    this.renderVehicleTypePicker();
  },

  renderSimProviderPicker() {
    const container = document.getElementById('simProviderPicker');
    if (!container) return;
    container.innerHTML = this.simProviders.map(s => `
      <label class="provider-radio-pill ${this.selectedSimProvider === s.id ? 'selected' : ''}" style="--provider-color: ${s.color};">
        <input type="radio" name="simProvider" value="${s.id}" ${this.selectedSimProvider === s.id ? 'checked' : ''} onchange="AdminApp.selectSimProvider('${s.id}')">
        <span>${s.label}</span>
      </label>
    `).join('');
  },

  selectSimProvider(providerId) {
    this.selectedSimProvider = providerId;
    this.renderSimProviderPicker();
  },

  renderLicensePresets() {
    const container = document.getElementById('licensePresetPicker');
    if (!container) return;
    container.innerHTML = this.licensePresets.map(p => `
      <div class="license-preset-card ${this.selectedPresetDays === p.days ? 'selected' : ''}" onclick="AdminApp.selectLicensePreset(${p.days})">
        <div class="preset-duration">${p.label}</div>
        <div class="preset-tag">${p.tag}</div>
      </div>
    `).join('');
  },

  selectLicensePreset(days) {
    this.selectedPresetDays = days;
    this.renderLicensePresets();
  },

  async openCreateVehicleModal() {
    this.editVehicleId = null;
    document.getElementById('vehicleModalTitle').textContent = 'Add New Vehicle';
    document.getElementById('vehicleForm').reset();
    this.selectedVehicleType = 'CAR';
    this.selectedSimProvider = 'Airtel';
    this.selectedPresetDays = 365;
    this.selectedUserIds = new Set(['usr_cust_01']);
    this.renderVehicleTypePicker();
    this.renderSimProviderPicker();
    this.renderLicensePresets();
    await this.populateUserCheckboxes();

    const drawer = document.getElementById('vehicleFormDrawer');
    if (drawer) drawer.classList.add('active');
  },

  async openEditVehicleModal(imei) {
    this.editVehicleId = imei;
    document.getElementById('vehicleModalTitle').textContent = 'Edit Vehicle Details';
    const drawer = document.getElementById('vehicleFormDrawer');
    if (drawer) drawer.classList.add('active');

    try {
      const res = await fetch(`/api/admin/vehicles/${imei}`);
      const json = await res.json();
      if (!json.success || !json.data) return;
      const v = json.data;

      document.getElementById('vFormPlate').value = v.numberPlate || v.registrationNumber || '';
      document.getElementById('vFormImei').value = v.imei || '';
      document.getElementById('vFormImei').readOnly = true;
      document.getElementById('vFormSimNumber').value = v.simNumber || '';
      document.getElementById('vFormOwnerName').value = v.ownerName || '';
      document.getElementById('vFormTankCapacity').value = v.tankCapacity || 480;
      document.getElementById('vFormFuelSource').value = v.fuelSource || 'CAN_PERCENT';
      document.getElementById('vFormProtocol').value = v.protocol || 'Teltonika Codec 8 Extended';
      document.getElementById('vFormAcAlert').checked = Boolean(v.acEnabled);
      document.getElementById('vFormCallAlert').checked = Boolean(v.callAlertEnabled);
      document.getElementById('vFormCallAlertPhone').value = v.callAlertPhoneNumber || '';

      this.selectedVehicleType = v.vehicleType || 'CAR';
      this.selectedSimProvider = v.simProvider || 'Airtel';
      this.selectedUserIds = new Set(v.userIds || []);

      this.renderVehicleTypePicker();
      this.renderSimProviderPicker();
      this.renderLicensePresets();
      await this.populateUserCheckboxes();
    } catch (err) {
      alert('Failed to load vehicle details: ' + err.message);
    }
  },

  closeVehicleFormDrawer() {
    const drawer = document.getElementById('vehicleFormDrawer');
    if (drawer) drawer.classList.remove('active');
  },

  async populateUserCheckboxes() {
    const container = document.getElementById('vehicleUsersCheckboxList');
    if (!container) return;
    try {
      const res = await fetch('/api/admin/users?limit=100');
      const json = await res.json();
      if (!json.success || !json.users) return;

      container.innerHTML = json.users.map(u => `
        <label class="user-select-item">
          <input type="checkbox" value="${u.id}" ${this.selectedUserIds.has(u.id) ? 'checked' : ''} onchange="AdminApp.toggleUserSelection('${u.id}', this.checked)">
          <span class="user-info">
            <strong>${u.name}</strong>
            <span class="user-role-badge badge-${u.role.toLowerCase()}">${u.role}</span>
          </span>
        </label>
      `).join('');
    } catch (err) {
      console.error('Error populating users:', err);
    }
  },

  toggleUserSelection(userId, checked) {
    if (checked) this.selectedUserIds.add(userId);
    else this.selectedUserIds.delete(userId);
  },

  async saveVehicle(e) {
    if (e) e.preventDefault();
    const plate = document.getElementById('vFormPlate').value.trim();
    const imei = document.getElementById('vFormImei').value.trim();
    const simNumber = document.getElementById('vFormSimNumber').value.trim();
    const ownerName = document.getElementById('vFormOwnerName').value.trim();
    const tankCapacity = document.getElementById('vFormTankCapacity').value;
    const fuelSource = document.getElementById('vFormFuelSource').value;
    const protocol = document.getElementById('vFormProtocol').value;
    const acEnabled = document.getElementById('vFormAcAlert').checked;
    const callAlertEnabled = document.getElementById('vFormCallAlert').checked;
    const callAlertPhoneNumber = document.getElementById('vFormCallAlertPhone').value.trim();

    if (!imei || imei.length < 5) {
      alert('Please enter a valid IMEI number');
      return;
    }
    if (!plate) {
      alert('Please enter Registration / Number Plate');
      return;
    }

    const payload = {
      imei,
      registrationNumber: plate,
      numberPlate: plate,
      vehicleType: this.selectedVehicleType,
      ownerName,
      simNumber,
      simProvider: this.selectedSimProvider,
      protocol,
      userIds: Array.from(this.selectedUserIds),
      licenseDurationDays: this.editVehicleId ? null : this.selectedPresetDays,
      tankCapacity: parseFloat(tankCapacity) || 480,
      fuelSource,
      acEnabled,
      callAlertEnabled,
      callAlertPhoneNumber
    };

    try {
      const url = this.editVehicleId ? `/api/admin/vehicles/${this.editVehicleId}` : '/api/admin/vehicles';
      const method = this.editVehicleId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) {
        alert('Error: ' + (json.error || 'Failed to save vehicle'));
        return;
      }

      this.closeVehicleFormDrawer();
      this.loadVehicles();
      this.loadStats();
      // Reload vehicles dropdown in main telemetry page
      if (typeof window.loadDevices === 'function') window.loadDevices();
    } catch (err) {
      alert('Failed to save vehicle: ' + err.message);
    }
  },

  async deleteVehicle(imei) {
    if (!confirm(`Are you sure you want to permanently delete vehicle IMEI ${imei}?`)) return;
    try {
      const res = await fetch(`/api/admin/vehicles/${imei}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) {
        alert('Failed to delete: ' + (json.error || 'Unknown error'));
        return;
      }
      this.loadVehicles();
      this.loadStats();
      if (typeof window.loadDevices === 'function') window.loadDevices();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  },

  // -------------------------------------------------------------
  // USER MANAGEMENT
  // -------------------------------------------------------------
  async loadUsers() {
    const tableBody = document.getElementById('adminUsersTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = `<tr><td colspan="6" class="loading-cell"><div class="spinner"></div> Loading users...</td></tr>`;

    const search = document.getElementById('adminUserSearch')?.value || '';
    const role = document.getElementById('adminUserRoleFilter')?.value || '';

    try {
      const res = await fetch(`/api/admin/users?search=${encodeURIComponent(search)}&role=${encodeURIComponent(role)}&limit=100`);
      const json = await res.json();
      if (!json.success || !json.users || json.users.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" class="empty-cell">No users found. Click "+ Add User" to register a new account.</td></tr>`;
        return;
      }

      tableBody.innerHTML = json.users.map(u => {
        const roleColor = u.role === 'ADMIN' ? 'badge-purple' : (u.role === 'DEALER' ? 'badge-gold' : (u.role === 'DRIVER' ? 'badge-green' : 'badge-blue'));
        const initials = (u.name || 'User').split(' ').map(w => w[0]).join('').substr(0, 2).toUpperCase();

        return `
          <tr data-user-id="${u.id}">
            <td>
              <div class="user-avatar-cell">
                <div class="user-avatar-circle">${initials}</div>
                <div>
                  <div class="user-full-name">${u.name}</div>
                  <div class="user-email">${u.email || 'No email'}</div>
                </div>
              </div>
            </td>
            <td><span class="badge ${roleColor}">${u.role}</span></td>
            <td>
              <div>${u.phone || '—'}</div>
              ${u.supportPhone ? `<div class="text-sub">Support: ${u.supportPhone}</div>` : ''}
            </td>
            <td><span class="badge badge-gray">${u.assignedVehicleCount || 0} Vehicles</span></td>
            <td><span class="badge ${u.status === 'ACTIVE' ? 'badge-green' : 'badge-red'}">${u.status}</span></td>
            <td class="actions-cell">
              <button class="btn-action-icon" title="Edit User" onclick="AdminApp.openEditUserModal('${u.id}')">✏️</button>
              <button class="btn-action-icon btn-danger" title="Delete User" onclick="AdminApp.deleteUser('${u.id}')">🗑️</button>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      tableBody.innerHTML = `<tr><td colspan="6" class="error-cell">Failed to load users: ${err.message}</td></tr>`;
    }
  },

  openCreateUserModal() {
    this.editUserId = null;
    document.getElementById('userModalTitle').textContent = 'Add New User Account';
    document.getElementById('userForm').reset();
    const modal = document.getElementById('userFormModal');
    if (modal) modal.classList.add('active');
    this.toggleDealerSupportFields('CUSTOMER');
  },

  async openEditUserModal(userId) {
    this.editUserId = userId;
    document.getElementById('userModalTitle').textContent = 'Edit User Account';
    const modal = document.getElementById('userFormModal');
    if (modal) modal.classList.add('active');

    try {
      const res = await fetch(`/api/admin/users/${userId}`);
      const json = await res.json();
      if (!json.success || !json.data) return;
      const u = json.data;

      document.getElementById('uFormName').value = u.name || '';
      document.getElementById('uFormEmail').value = u.email || '';
      document.getElementById('uFormPhone').value = u.phone || '';
      document.getElementById('uFormRole').value = u.role || 'CUSTOMER';
      document.getElementById('uFormAddress').value = u.address || '';
      document.getElementById('uFormSupportPhone').value = u.supportPhone || '';
      document.getElementById('uFormSupportEmail').value = u.supportEmail || '';
      document.getElementById('uFormSupportAddress').value = u.supportAddress || '';

      this.toggleDealerSupportFields(u.role);
    } catch (err) {
      alert('Failed to load user: ' + err.message);
    }
  },

  closeUserFormModal() {
    const modal = document.getElementById('userFormModal');
    if (modal) modal.classList.remove('active');
  },

  toggleDealerSupportFields(role) {
    const sec = document.getElementById('dealerSupportFields');
    if (sec) {
      sec.style.display = (role === 'DEALER' || role === 'ADMIN') ? 'block' : 'none';
    }
  },

  async saveUser(e) {
    if (e) e.preventDefault();
    const name = document.getElementById('uFormName').value.trim();
    const email = document.getElementById('uFormEmail').value.trim();
    const phone = document.getElementById('uFormPhone').value.trim();
    const role = document.getElementById('uFormRole').value;
    const address = document.getElementById('uFormAddress').value.trim();
    const supportPhone = document.getElementById('uFormSupportPhone').value.trim();
    const supportEmail = document.getElementById('uFormSupportEmail').value.trim();
    const supportAddress = document.getElementById('uFormSupportAddress').value.trim();

    if (!name) {
      alert('Please enter user full name');
      return;
    }

    const payload = {
      name,
      email,
      phone,
      role,
      address,
      supportPhone,
      supportEmail,
      supportAddress
    };

    try {
      const url = this.editUserId ? `/api/admin/users/${this.editUserId}` : '/api/admin/users';
      const method = this.editUserId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) {
        alert('Error: ' + (json.error || 'Failed to save user'));
        return;
      }

      this.closeUserFormModal();
      this.loadUsers();
      this.loadStats();
    } catch (err) {
      alert('Failed to save user: ' + err.message);
    }
  },

  async deleteUser(userId) {
    if (!confirm('Are you sure you want to delete this user account?')) return;
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) {
        alert('Failed to delete: ' + (json.error || 'Unknown error'));
        return;
      }
      this.loadUsers();
      this.loadStats();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  },

  // -------------------------------------------------------------
  // LICENSE MANAGEMENT
  // -------------------------------------------------------------
  async loadLicenses() {
    const tableBody = document.getElementById('adminLicensesTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = `<tr><td colspan="6" class="loading-cell"><div class="spinner"></div> Loading licenses...</td></tr>`;

    const status = document.getElementById('adminLicenseStatusFilter')?.value || '';

    try {
      const res = await fetch(`/api/admin/licenses?status=${encodeURIComponent(status)}&limit=100`);
      const json = await res.json();
      if (!json.success || !json.licenses || json.licenses.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" class="empty-cell">No licenses found. Click "+ Generate License Keys" to create a new batch.</td></tr>`;
        return;
      }

      tableBody.innerHTML = json.licenses.map(l => {
        const isAvail = l.status === 'AVAILABLE';
        const isAct = l.status === 'ACTIVE';
        const statusBadge = isAct ? `<span class="badge badge-green">ACTIVE</span>` : (isAvail ? `<span class="badge badge-blue">AVAILABLE</span>` : `<span class="badge badge-red">${l.status}</span>`);

        return `
          <tr>
            <td><span class="mono-key-badge">${l.licenseKey}</span></td>
            <td><strong>${l.durationInfo || `${l.durationValue} ${l.durationUnit}`}</strong></td>
            <td>${statusBadge}</td>
            <td>${l.vehicleNumberPlate || (l.vehicleId ? `<span class="mono-text">${l.vehicleId}</span>` : '<span class="text-muted">Unassigned</span>')}</td>
            <td>${l.expiresAt ? new Date(l.expiresAt).toLocaleDateString() : '—'}</td>
            <td class="actions-cell">
              ${isAvail ? `<button class="btn-action-icon" title="Copy Key" onclick="navigator.clipboard.writeText('${l.licenseKey}'); alert('Copied license key!')">📋</button>` : ''}
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      tableBody.innerHTML = `<tr><td colspan="6" class="error-cell">Failed to load licenses: ${err.message}</td></tr>`;
    }
  },

  openGenerateLicenseModal() {
    const modal = document.getElementById('generateLicenseModal');
    if (modal) modal.classList.add('active');
  },

  closeGenerateLicenseModal() {
    const modal = document.getElementById('generateLicenseModal');
    if (modal) modal.classList.remove('active');
  },

  async generateLicenses(e) {
    if (e) e.preventDefault();
    const durationValue = document.getElementById('genDurationValue').value;
    const durationUnit = document.getElementById('genDurationUnit').value;
    const count = document.getElementById('genCount').value;

    try {
      const res = await fetch('/api/admin/licenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ durationValue, durationUnit, count })
      });
      const json = await res.json();
      if (!json.success) {
        alert('Failed to generate licenses: ' + (json.error || 'Unknown error'));
        return;
      }
      this.closeGenerateLicenseModal();
      this.loadLicenses();
      this.loadStats();
      alert(`Generated ${json.data.length} license keys successfully!`);
    } catch (err) {
      alert('Error: ' + err.message);
    }
  },

  openRenewLicenseModal(imei) {
    const modal = document.getElementById('renewLicenseModal');
    if (!modal) return;
    document.getElementById('renewVehicleImei').value = imei;
    modal.classList.add('active');
  },

  closeRenewLicenseModal() {
    const modal = document.getElementById('renewLicenseModal');
    if (modal) modal.classList.remove('active');
  },

  async submitRenewLicense(e) {
    if (e) e.preventDefault();
    const vehicleId = document.getElementById('renewVehicleImei').value;
    const durationDays = document.getElementById('renewDurationDays').value;

    try {
      const res = await fetch('/api/admin/licenses/renew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicleId, durationDays: parseInt(durationDays, 10) })
      });
      const json = await res.json();
      if (!json.success) {
        alert('Failed to renew license: ' + (json.error || 'Unknown error'));
        return;
      }
      this.closeRenewLicenseModal();
      this.loadVehicles();
      this.loadLicenses();
      this.loadStats();
      alert('License renewed successfully!');
    } catch (err) {
      alert('Error: ' + err.message);
    }
  }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  AdminApp.init();
});
