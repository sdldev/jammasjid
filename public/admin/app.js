// Jam Masjid Santrimu admin dashboard — phone-native SPA.
// Pattern: grouped menu → drill into a section page (hash router) → back.
// Every operation goes through POST /api/proses (contract unchanged).

var app = {
  db: null,

  api: function (id, dt) {
    var payload = { id: id }
    if (dt !== undefined) payload.dt = dt
    return $.ajax({ type: 'POST', url: '/api/proses', dataType: 'json', data: payload })
  },

  // Upload multipart (logo): kirim FormData langsung, id di dalam form.
  apiUpload: function (formData) {
    return $.ajax({
      type: 'POST',
      url: '/api/proses',
      dataType: 'json',
      data: formData,
      processData: false,
      contentType: false
    })
  },

  // Bottom toast — mobile-app style feedback
  toastTimer: null,
  toast: function (type, message) {
    var $t = $('#toast')
    $t.attr('class', 'toast show ' + type).text(message)
    clearTimeout(app.toastTimer)
    app.toastTimer = setTimeout(function () { $t.removeClass('show') }, 2500)
  },

  // ------------------------------------------------------------ session & boot
  init: function () {
    $('#form-login').on('submit', app.onLogin)
    $('#btn-logout').on('click', app.onLogout)
    $(window).on('hashchange', app.route)
    app.refresh()
  },

  refresh: function () {
    app.api('readDatabase')
      .done(function (res) {
        if (!res.registered || !res.data) app.showLogin()
        else { app.db = res.data; app.showApp() }
      })
      .fail(function () { app.toast('danger', 'Gagal menghubungi server') })
  },

  showLogin: function () {
    $('#view-app').hide()
    $('#view-login').show()
  },

  showApp: function () {
    $('#view-login').hide()
    $('#view-app').show()
    app.route()
  },

  onLogin: function (e) {
    e.preventDefault()
    var user = $('#form-login [name=user]').val()
    var pass = $('#form-login [name=pass]').val()
    app.api('login', { user: user, pass: pass })
      .done(function (res) {
        if (res.success) { app.toast('success', 'Login berhasil'); app.refresh() }
        else app.toast('danger', res.data)
      })
      .fail(function () { app.toast('danger', 'Gagal menghubungi server') })
  },

  onLogout: function () {
    app.api('logout').always(function () {
      app.toast('success', 'Anda telah logout')
      location.hash = ''
      app.showLogin()
    })
  },

  // ------------------------------------------------------------ routing
  route: function () {
    if (!app.db) return
    var page = (location.hash || '#/').replace(/^#\/?/, '')
    var render = app.pages[page] || app.pages['']
    render()
  },

  // Generic form helper: save an object via formSave no-index
  saveForm: function (formId, $form, fields, title) {
    var dt = { formId: formId, index: 'no-index' }
    fields.forEach(function (field) {
      dt[field.name] = $form.find('[name=' + field.name + ']').val()
    })
    app.api('formSave', dt).done(function (res) {
      if (res.success) { app.toast('success', title + ' tersimpan'); app.refresh() }
      else app.toast('danger', res.data)
    })
  },

  // Small inline SVG icons (replacing Font Awesome)
  icon: function (path, cls) {
    return '<span class="row-icon ' + (cls || '') + '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round">' + path + '</svg></span>'
  },

  // Deterministic Rupiah formatting without toLocaleString (2200000 -> "Rp 2.200.000")
  formatRupiah: function (n) {
    var num = Math.round(Number(n) || 0)
    var sign = num < 0 ? '-' : ''
    var digits = String(Math.abs(num)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    return sign + 'Rp ' + digits
  },

  // Treasury balance summary for the menu subtitle (safe when db.kas is missing)
  kasRingkasan: function () {
    var kas = app.db.kas
    if (!kas) return 'belum diisi'
    var aktif = kas.active === true || kas.active === '1' || kas.active === 1
    if (!aktif) return 'tidak aktif'
    var bulanLalu = Number(kas.kas_bulan_lalu) || 0
    var pendapatan = Number(kas.pendapatan) || 0
    var pengeluaran = Number(kas.pengeluaran) || 0
    // Matches the display: all zeros & empty account = not filled in
    if (!bulanLalu && !pendapatan && !pengeluaran && !String(kas.rekening).trim()) return 'belum diisi'
    return 'saldo ' + app.formatRupiah(bulanLalu + pendapatan - pengeluaran)
  },

  // Logo summary for the menu subtitle: none / kiri / kanan / kiri+kanan
  logoRingkasan: function () {
    var logo = app.db.logo || {}
    var ada = []
    if (String(logo.left || '').trim()) ada.push('kiri')
    if (String(logo.right || '').trim()) ada.push('kanan')
    var posisi = logo.position === 'above_clock' ? 'atas jam' : 'samping nama'
    return (ada.length ? ada.join(' + ') : 'belum ada logo') + ' · ' + posisi
  },

  ICONS: {
    mosque: '<path d="M12 2c2 2.5 3 4 3 5.5V9H9V7.5C9 6 10 4.5 12 2z"/><path d="M4 22V13c0-1 1-2 2-2h12c1 0 2 1 2 2v9"/><path d="M4 22h16"/><path d="M10 22v-4a2 2 0 1 1 4 0v4"/>',
    location: '<path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    tune: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><path d="M1 14h6M9 8h6M17 16h6"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M9 2h6"/>',
    hourglass: '<path d="M6 2h12M6 22h12"/><path d="M7 2c0 5 5 6 5 10s-5 5-5 10M17 2c0 5-5 6-5 10s5 5 5 10"/>',
    text: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 1 1 8 0v4"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    calc: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h.01M16 19h.01"/>',
    wallet: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1"/>',
    cloud: '<path d="M17.5 19a4.5 4.5 0 0 0 .9-8.9 6 6 0 0 0-11.7 1.7A4 4 0 0 0 6 19h11.5z"/><path d="M12 12v6"/><path d="M9 15l3-3 3 3"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
    update: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
    wifi: '<path d="M5 12.55a11 11 0 0 1 14 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1"/>'
  },

  // Kemenag sync status summary for the menu subtitle
  kemenagRingkasan: function () {
    var k = (app.db && app.db.kemenag) || {}
    var on = function (v) { return v === true || v === '1' || v === 1 }
    if (!on(k.active)) return 'tidak aktif'
    if (!k.provid || !k.kabkotid) return 'wilayah belum diisi'
    if (!k.last_sync) return 'belum pernah sinkron'
    var d = new Date(k.last_sync)
    return 'sinkron ' + d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) +
      ' ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
  },

  pages: {} // diisi di bawah
}

// ================================================================ pages
;(function () {
  var $c = function () { return $('#app-container') }

  function setHeader(title, back) {
    $('#appbar-title').text(title)
    $('#appbar-back').html(
      back ? '<a class="back-link" href="#/">&#8249; Kembali</a>' : ''
    )
    window.scrollTo(0, 0)
  }

  // Escape untuk nilai dinamis (SSID bisa berisi karakter HTML).
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  }

  // Tombol mata untuk input password (dipakai field() dan form WiFi).
  function eyeToggleHtml() {
    return '<button type="button" class="pass-eye" tabindex="-1" aria-label="Tampilkan password">' +
      '<svg class="eye-open" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' +
      '<svg class="eye-closed" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none">' +
      '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>' +
      '<line x1="1" y1="1" x2="23" y2="23"/></svg>' +
      '</button>'
  }

  function field(label, name, value, opts) {
    opts = opts || {}
    var input
    if (opts.type === 'textarea') {
      input = '<textarea class="input" rows="2" name="' + name + '" maxlength="' + (opts.maxlength || 255) + '"' +
        (opts.placeholder ? ' placeholder="' + opts.placeholder + '"' : '') + '></textarea>'
    } else {
      input = '<input class="input' + (opts.arabic ? ' arabic' : '') + '" name="' + name + '"' +
        ' type="' + (opts.type || 'text') + '"' +
        (opts.inputmode ? ' inputmode="' + opts.inputmode + '"' : '') +
        (opts.step ? ' step="' + opts.step + '"' : '') +
        (opts.maxlength ? ' maxlength="' + opts.maxlength + '"' : '') +
        (opts.placeholder ? ' placeholder="' + opts.placeholder + '"' : '') +
        (opts.required === false ? '' : ' required') + '>'
    }
    // Toggle mata: input type=password dibungkus agar bisa ditampilkan/disembunyikan.
    if (opts.type === 'password') {
      input = '<div class="pass-wrap">' + input + eyeToggleHtml() + '</div>'
    }
    return '<div class="field"><label>' + label + '</label>' + input + '</div>'
  }

  // Delegasi klik tombol mata (form dibuat dinamis setiap halaman dirender).
  $(document).on('click', '.pass-eye', function () {
    var $input = $(this).closest('.pass-wrap').find('input')
    var show = $input.attr('type') === 'password'
    $input.attr('type', show ? 'text' : 'password')
    $(this).find('.eye-open').toggle(!show)
    $(this).find('.eye-closed').toggle(show)
    $(this).attr('aria-label', show ? 'Sembunyikan password' : 'Tampilkan password')
  })

  function toggleRow(label, name, checked) {
    return '<div class="switch-row"><span class="switch-label">' + label + '</span>' +
      '<span class="switch"><input type="checkbox" name="' + name + '"' + (checked ? ' checked' : '') + '>' +
      '<span class="track"></span></span></div>'
  }

  function stepperRow(label, name, value, min, max) {
    return '<div class="field"><label>' + label + '</label>' +
      '<div class="stepper">' +
      '<button type="button" data-step="-1" aria-label="Kurangi">&#8722;</button>' +
      '<input class="input" name="' + name + '" type="number" value="' + value + '" min="' + min + '" max="' + max + '" step="1" inputmode="numeric">' +
      '<button type="button" data-step="1" aria-label="Tambah">+</button>' +
      '</div></div>'
  }

  // Stepper +/- button handler: clamp the value
  function bindSteppers($scope) {
    $scope.find('.stepper button').on('click', function () {
      var $input = $(this).siblings('input')
      var min = Number($input.attr('min')), max = Number($input.attr('max'))
      var val = (Number($input.val()) || 0) + Number($(this).data('step'))
      $input.val(Math.max(min, Math.min(max, val)))
    })
  }

  var isOn = function (v) { return v === true || v === '1' || v === 1 }
  app.isOn = isOn

  // ------------------------------------------------ main menu
  app.pages[''] = function () {
    setHeader(app.db.setting.nama || 'Jam Masjid Santrimu', false)
    var I = app.ICONS
    function row(hash, icon, iconCls, title, sub) {
      return '<a class="row-link" href="#/' + hash + '">' +
        app.icon(icon, iconCls) +
        '<span class="row-text"><span class="row-title">' + title + '</span>' +
        (sub ? '<span class="row-sub">' + sub + '</span>' : '') + '</span>' +
        '<span class="chevron">&#8250;</span></a>'
    }
    var db = app.db
    $c().html(
      '<div class="group-label">Pengaturan masjid</div><div class="group-card">' +
      row('masjid', I.mosque, '', 'Info masjid', db.setting.nama + ' · ' + db.setting.lokasi) +
      row('lokasi', I.location, '', 'Lokasi', db.setting.latitude + ', ' + db.setting.longitude) +
      row('tune', I.tune, '', 'Penyesuaian waktu sholat', 'geser jadwal ±60 menit') +
      row('metode', I.calc, '', 'Metode perhitungan', db.prayTimesMethod === '0' ? 'manual parameter' : db.prayTimesMethod) +
      row('kemenag', I.cloud, '', 'Jadwal resmi Kemenag', app.kemenagRingkasan()) +
      '</div>' +
      '<div class="group-label">Display</div><div class="group-card">' +
      row('timer', I.timer, '', 'Timer display', 'menuju adzan · adzan') +
      row('iqomah', I.hourglass, 'gold', 'Timer iqomah', db.iqomah.dhuhr + ' menit tiap waktu') +
      row('logo', I.image, '', 'Logo masjid', app.logoRingkasan()) +
      '</div>' +
      '<div class="group-label">Konten</div><div class="group-card">' +
      row('running-text', I.text, '', 'Running text', db.running_text.length + ' item') +
      row('kas', I.wallet, 'gold', 'Kas masjid', app.kasRingkasan()) +
      '</div>' +
      '<div class="group-label">Lainnya</div><div class="group-card">' +
      row('wifi', I.wifi, '', 'WiFi', 'pindai · sambung · prioritas') +
      row('remote', I.cloud, '', 'Remote (Tailscale)', ((db.tailscale && db.tailscale.pengurus_emails) || []).length + ' email pengurus') +
      row('password', I.lock, '', 'Ganti password', '') +
      row('update', I.update, '', 'Update sistem', 'perbarui ke versi terbaru') +
      '<div class="row-link" id="row-reset">' +
      app.icon(I.reset, 'red') +
      '<span class="row-text"><span class="row-title">Reset pengaturan</span></span>' +
      '<span class="chevron">&#8250;</span></div>' +
      '</div>' +
      '<div class="app-footer">' +
      '<a class="btn btn-ghost" href="/" target="_blank">Lihat display</a>' +
      '<button class="btn btn-danger" id="btn-logout-2">Logout</button>' +
      '</div>'
    )
    $('#btn-logout-2').on('click', app.onLogout)
    app.bindReset('#row-reset')
  }

  // Reset with inline 2-tap confirmation (replacing window.prompt)
  app.bindReset = function (selector) {
    $(selector).on('click', function () {
      var $self = $(this)
      if ($self.data('confirm')) return
      $self.data('confirm', true)
      var orig = $self.find('.row-title').text()
      $self.find('.row-title').text('Yakin reset semua pengaturan?')
      $self.find('.row-sub').remove()
      $self.css('background', 'var(--danger-soft)')
      var $btns = $('<div class="confirm-box show" style="margin-left:44px">' +
        '<button class="btn btn-danger">Ya, reset</button>' +
        '<button class="btn btn-ghost">Batal</button></div>').insertAfter($self)
      $btns.find('.btn-danger').on('click', function () {
        app.api('resetDevice', 'KONFIRMASI').done(function (res) {
          if (res.success) { app.toast('success', 'Pengaturan direset. Login kembali.'); app.showLogin() }
          else app.toast('danger', res.data)
        })
      })
      $btns.find('.btn-ghost').on('click', function () {
        $btns.remove()
        $self.data('confirm', false).css('background', '')
        $self.find('.row-title').text(orig)
      })
    })
  }

  // ------------------------------------------------ mosque info
  app.pages['masjid'] = function () {
    setHeader('Info masjid', true)
    var s = app.db.setting
    $c().html(
      '<div class="card"><form id="f-masjid">' +
      field('Nama masjid', 'nama', '', { required: true }) +
      field('Lokasi', 'lokasi', '', { required: true }) +
      '<button class="btn btn-primary btn-block" type="submit">Simpan</button>' +
      '</form></div>'
    )
    $('#f-masjid [name=nama]').val(s.nama)
    $('#f-masjid [name=lokasi]').val(s.lokasi)
    $('#f-masjid').on('submit', function (e) {
      e.preventDefault()
      app.saveForm('setting', $(this), [{ name: 'nama' }, { name: 'lokasi' }], 'Info masjid')
    })
  }

  // ------------------------------------------------ logo (kiri/kanan judul)
  app.pages['logo'] = function () {
    setHeader('Logo masjid', true)
    var logo = app.db.logo || {}

    // Satu blok upload per sisi (kiri/kanan) — perilaku identik.
    function sideBlock(side, label) {
      var url = String(logo[side] || '').trim()
      return '<div class="card">' +
        '<div class="field"><label>' + label + '</label>' +
        '<div class="logo-preview">' +
        (url ? '<img src="' + url + '" alt="Logo ' + label + '">' : '<span class="logo-empty">Belum ada logo</span>') +
        '</div></div>' +
        '<input class="input" type="file" accept="image/png,image/jpeg" id="file-' + side + '">' +
        '<div class="btn-row">' +
        '<button class="btn btn-primary" id="up-' + side + '">Unggah</button>' +
        (url ? '<button class="btn btn-danger" id="del-' + side + '">Hapus</button>' : '') +
        '</div>' +
        '<p class="field-note">PNG / JPG, maksimal 4 MB. Tanpa logo = hanya nama masjid.</p>' +
        '</div>'
    }

    // Kartu posisi logo — mode tampilan di display.
    // 'beside_name' = default (termasuk db lama yang belum punya key position).
    var position = logo.position === 'above_clock' ? 'above_clock' : 'beside_name'
    var positionCard =
      '<div class="card">' +
      '<div class="field"><label>Posisi logo</label>' +
      '<div class="segmented" id="seg-logo-pos">' +
      '<button type="button" data-v="beside_name"' + (position === 'beside_name' ? ' class="active"' : '') + '>Di samping nama masjid</button>' +
      '<button type="button" data-v="above_clock"' + (position === 'above_clock' ? ' class="active"' : '') + '>Di atas jam</button>' +
      '</div>' +
      '<p class="field-note">"Di atas jam" hanya menampilkan SATU logo — logo kiri diprioritaskan, atau logo kanan jika kiri kosong. Tanpa logo terunggah, tidak ada yang tampil.</p>' +
      '</div>' +
      '<button class="btn btn-primary btn-block" id="save-logo-pos">Simpan posisi</button>' +
      '</div>'

    $c().html(positionCard + sideBlock('left', 'Logo kiri') + sideBlock('right', 'Logo kanan'))

    $('#seg-logo-pos button').on('click', function () {
      $('#seg-logo-pos button').removeClass('active')
      $(this).addClass('active')
    })
    $('#save-logo-pos').on('click', function () {
      app.api('formSave', {
        formId: 'logo', index: 'no-index',
        position: $('#seg-logo-pos button.active').data('v')
      }).done(function (res) {
        if (res.success) { app.toast('success', 'Posisi logo tersimpan'); app.refresh() }
        else app.toast('danger', res.data)
      }).fail(function () { app.toast('danger', 'Gagal menghubungi server') })
    })

    function bindSide(side) {
      var uploading = false

      // Preview instan saat file dipilih — lihat gambar SEBELUM menekan Unggah.
      // Validasi ringan di klien (tipe & ukuran) memberi feedback cepat;
      // server tetap memvalidasi ulang (sumber kebenaran).
      $('#file-' + side).on('change', function () {
        var input = this
        var files = input.files
        var $preview = $('#file-' + side).closest('.card').find('.logo-preview')
        if (!files || !files.length) return
        var f = files[0]
        if (['image/png', 'image/jpeg'].indexOf(f.type) < 0) {
          app.toast('danger', 'Tipe file harus PNG atau JPG')
          input.value = ''
          return
        }
        if (f.size > 4 * 1024 * 1024) {
          app.toast('danger', 'Ukuran file maksimal 4 MB')
          input.value = ''
          return
        }
        // Tampilkan preview lokal + info ukuran; bebaskan object URL lama
        if (window.__logoObjUrl && window.__logoObjUrl[side]) URL.revokeObjectURL(window.__logoObjUrl[side])
        window.__logoObjUrl = window.__logoObjUrl || {}
        window.__logoObjUrl[side] = URL.createObjectURL(f)
        $preview.html('<img src="' + window.__logoObjUrl[side] + '" alt="Preview">' +
          '<span class="logo-pending">' + (f.size / 1024).toFixed(0) + ' KB — belum diunggah, tekan Unggah</span>')
      })

      $('#up-' + side).on('click', function () {
        var files = $('#file-' + side)[0] && $('#file-' + side)[0].files
        if (!files || !files.length) { app.toast('danger', 'Pilih file logo dulu'); return }
        if (uploading) return
        uploading = true
        var $btn = $(this)
        $btn.text('Mengunggah...').prop('disabled', true)
        var fd = new FormData()
        fd.append('id', 'logoUpload')
        fd.append('side', side)
        fd.append('file', files[0])
        app.apiUpload(fd)
          .done(function (res) {
            if (res.success) {
              app.toast('success', 'Logo ' + side + ' tersimpan')
              app.refresh() // re-render: preview permanen dari server
            } else app.toast('danger', res.data)
          })
          .fail(function () { app.toast('danger', 'Gagal menghubungi server') })
          .always(function () { uploading = false; $btn.text('Unggah').prop('disabled', false) })
      })
      $('#del-' + side).on('click', function () {
        app.api('logoRemove', { side: side })
          .done(function (res) {
            if (res.success) { app.toast('success', 'Logo ' + side + ' dihapus'); app.refresh() }
            else app.toast('danger', res.data)
          })
          .fail(function () { app.toast('danger', 'Gagal menghubungi server') })
      })
    }
    bindSide('left')
    bindSide('right')
  }

  // ------------------------------------------------ location
  app.pages['lokasi'] = function () {
    setHeader('Lokasi', true)
    var s = app.db.setting
    $c().html(
      '<div class="card"><form id="f-lokasi">' +
      field('Latitude', 'latitude', '', { type: 'number', step: 'any', inputmode: 'decimal' }) +
      field('Longitude', 'longitude', '', { type: 'number', step: 'any', inputmode: 'decimal' }) +
      field('Zona waktu (GMT)', 'timeZone', '', { type: 'number', inputmode: 'numeric' }) +
      '<div class="field"><label>DST (Daylight Saving Time)</label>' +
      '<div class="segmented" id="seg-dst">' +
      ['0', '1', 'Auto'].map(function (v) {
        return '<button type="button" data-v="' + v + '"' + (String(s.dst) === v ? ' class="active"' : '') + '>' + v + '</button>'
      }).join('') +
      '</div><p class="field-note">Untuk Indonesia pilih 0.</p></div>' +
      '<button class="btn btn-primary btn-block" type="submit">Simpan</button>' +
      '</form></div>'
    )
    $('#f-lokasi [name=latitude]').val(s.latitude)
    $('#f-lokasi [name=longitude]').val(s.longitude)
    $('#f-lokasi [name=timeZone]').val(s.timeZone)
    $('#seg-dst button').on('click', function () {
      $('#seg-dst button').removeClass('active')
      $(this).addClass('active')
    })
    $('#f-lokasi').on('submit', function (e) {
      e.preventDefault()
      var dt = {
        formId: 'setting', index: 'no-index',
        latitude: $('[name=latitude]').val(),
        longitude: $('[name=longitude]').val(),
        timeZone: $('[name=timeZone]').val(),
        dst: $('#seg-dst button.active').data('v')
      }
      app.api('formSave', dt).done(function (res) {
        if (res.success) { app.toast('success', 'Lokasi tersimpan'); app.refresh() }
        else app.toast('danger', res.data)
      })
    })
  }

  // ------------------------------------------------ calculation method
  app.pages['metode'] = function () {
    setHeader('Metode perhitungan', true)
    var db = app.db
    var methods = { '0': 'Manual parameter', MWL: 'Muslim World League', ISNA: 'ISNA', Egypt: 'Egyptian Authority', Makkah: 'Umm al-Qura, Makkah', Karachi: 'Karachi', Tehran: 'Tehran', Jafari: 'Jafari' }
    var options = Object.keys(methods).map(function (k) {
      return '<option value="' + k + '"' + (String(db.prayTimesMethod) === k ? ' selected' : '') + '>' + methods[k] + '</option>'
    }).join('')
    var adjustFields = Object.keys(db.prayTimesAdjust).map(function (key) {
      return field('Adjust: ' + key, 'adjust_' + key, '', { required: false, placeholder: 'kosong = default' })
    }).join('')
    $c().html(
      '<div class="card"><form id="f-metode">' +
      '<div class="field"><label>Metode</label><select class="input" name="prayTimesMethod">' + options + '</select></div>' +
      '<div id="adjust-wrap">' + adjustFields +
      '<p class="field-note">fajr/isha = derajat, dhuhr/maghrib = menit, asr = Standard/Hanafi. Kosongkan jika pakai default.</p></div>' +
      '<button class="btn btn-primary btn-block" type="submit">Simpan</button>' +
      '</form></div>'
    )
    Object.keys(db.prayTimesAdjust).forEach(function (key) {
      $('#f-metode [name=adjust_' + key + ']').val(db.prayTimesAdjust[key])
    })
    $('#f-metode').on('submit', function (e) {
      e.preventDefault()
      var dt = { formId: 'prayTimesAdjust', index: 'no-index', prayTimesMethod: $('[name=prayTimesMethod]').val() }
      Object.keys(db.prayTimesAdjust).forEach(function (key) {
        dt[key] = $('[name=adjust_' + key + ']').val()
      })
      app.api('formSave', dt).done(function (res) {
        if (res.success) { app.toast('success', 'Metode tersimpan'); app.refresh() }
        else app.toast('danger', res.data)
      })
    })
  }

  // ------------------------------------------------ time adjustment (tune)
  app.pages['tune'] = function () {
    setHeader('Penyesuaian waktu', true)
    var tune = app.db.prayTimesTune || {}
    var names = app.db.prayName
    var rows = Object.keys(tune).map(function (key) {
      return stepperRow(names[key] || key, key, tune[key], -60, 60)
    }).join('')
    $c().html(
      '<div class="card"><form id="f-tune">' + rows +
      '<p class="field-note">Geser jadwal sholat −60 sampai +60 menit. Contoh: +2 untuk ihtiyati (pengaman).</p>' +
      '<button class="btn btn-primary btn-block" type="submit">Simpan</button>' +
      '</form></div>'
    )
    bindSteppers($('#f-tune'))
    $('#f-tune').on('submit', function (e) {
      e.preventDefault()
      var dt = { formId: 'prayTimesTune', index: 'no-index' }
      Object.keys(tune).forEach(function (key) { dt[key] = $('[name=' + key + ']').val() })
      app.api('formSave', dt).done(function (res) {
        if (res.success) { app.toast('success', 'Penyesuaian tersimpan'); app.refresh() }
        else app.toast('danger', res.data)
      })
    })
  }

  // ------------------------------------------------ display timers
  app.pages['timer'] = function () {
    setHeader('Timer display', true)
    var timer = app.db.timer
    var labels = { wait_adzan: 'Menuju adzan (menit)', adzan: 'Durasi adzan (menit)' }
    var rows = Object.keys(timer).map(function (key) {
      return field(labels[key] || key, key, '', { type: 'number', inputmode: 'numeric' })
    }).join('')
    $c().html('<div class="card"><form id="f-timer">' + rows +
      '<button class="btn btn-primary btn-block" type="submit">Simpan</button></form></div>')
    Object.keys(timer).forEach(function (key) { $('#f-timer [name=' + key + ']').val(timer[key]) })
    $('#f-timer').on('submit', function (e) {
      e.preventDefault()
      app.saveForm('timer', $(this), Object.keys(timer).map(function (k) { return { name: k } }), 'Timer display')
    })
  }

  // ------------------------------------------------ iqomah timers
  app.pages['iqomah'] = function () {
    setHeader('Timer iqomah', true)
    var iqomah = app.db.iqomah
    var names = app.db.prayName
    var rows = Object.keys(iqomah).map(function (key) {
      return field('Iqomah ' + (names[key] || key) + ' (menit)', key, '', { type: 'number', inputmode: 'numeric' })
    }).join('')
    $c().html('<div class="card"><form id="f-iqomah">' + rows +
      '<button class="btn btn-primary btn-block" type="submit">Simpan</button></form></div>')
    Object.keys(iqomah).forEach(function (key) { $('#f-iqomah [name=' + key + ']').val(iqomah[key]) })
    $('#f-iqomah').on('submit', function (e) {
      e.preventDefault()
      app.saveForm('iqomah', $(this), Object.keys(iqomah).map(function (k) { return { name: k } }), 'Timer iqomah')
    })
  }

  // ------------------------------------------------ running text
  app.pages['running-text'] = function () {
    setHeader('Running text', true)
    var list = app.db.running_text
    var cards = list.map(function (text, i) {
      return '<div class="list-card" data-index="' + i + '">' +
        '<div class="list-card-head"><span class="list-card-title">Teks ' + (i + 1) + '</span>' +
        '<button type="button" class="delete-btn">&#128465; hapus</button></div>' +
        '<form><div class="field"><textarea class="input" rows="3" name="text" maxlength="255" required></textarea></div>' +
        '<button class="btn btn-primary btn-block" type="submit">Simpan</button>' +
        '</form></div>'
    }).join('')
    var addCard =
      '<div class="list-card add-card" data-index="new"><form>' +
      '<div class="list-card-head"><span class="list-card-title">Tambah baru</span></div>' +
      '<div class="field"><textarea class="input" rows="3" name="text" maxlength="255" required></textarea></div>' +
      '<button class="btn btn-primary btn-block" type="submit">Tambah</button>' +
      '</form></div>'
    $c().html(addCard + cards)
    $c().find('.list-card').each(function () {
      var $card = $(this)
      var idx = $card.data('index')
      if (idx !== 'new') $card.find('[name=text]').val(list[idx])
    })
    $c().find('form').on('submit', function (e) {
      e.preventDefault()
      var $card = $(this).closest('.list-card')
      app.api('formSave', {
        formId: 'running_text', index: String($card.data('index')),
        text: $card.find('[name=text]').val()
      }).done(function (res) {
        if (res.success) { app.toast('success', 'Tersimpan'); app.refresh() }
        else app.toast('danger', res.data)
      })
    })
    $c().find('.delete-btn').on('click', function () {
      var idx = String($(this).closest('.list-card').data('index'))
      app.api('formDelete', { formId: 'running_text', index: idx }).done(function (res) {
        if (res.success) { app.toast('success', 'Item dihapus'); app.refresh() }
        else app.toast('danger', res.data)
      })
    })
  }

  // ------------------------------------------------ mosque treasury
  app.pages['kas'] = function () {
    setHeader('Kas masjid', true)
    var kas = app.db.kas || { active: false, rekening: '', kas_bulan_lalu: 0, pendapatan: 0, pengeluaran: 0 }
    $c().html(
      '<div class="card"><form id="f-kas">' +
      toggleRow('Aktif', 'active', isOn(kas.active)) +
      field('Rekening infaq', 'rekening', '', { maxlength: 100, required: false, placeholder: 'cth: BSI 7123456789 a.n. Masjid' }) +
      '<p class="field-note">Kosongkan jika tidak ingin menampilkan info rekening.</p>' +
      field('Kas bulan lalu (Rp)', 'kas_bulan_lalu', '', { type: 'number', inputmode: 'numeric', step: '1', required: false }) +
      field('Pendapatan bulan ini (Rp)', 'pendapatan', '', { type: 'number', inputmode: 'numeric', step: '1', required: false }) +
      field('Pengeluaran bulan ini (Rp)', 'pengeluaran', '', { type: 'number', inputmode: 'numeric', step: '1', required: false }) +
      '<div class="kas-saldo"><span>Saldo (otomatis)</span><strong id="kas-saldo-nilai">Rp 0</strong></div>' +
      '<p class="field-note">Saldo = kas bulan lalu + pendapatan − pengeluaran. Ditampilkan pertama pada running text.</p>' +
      '<button class="btn btn-primary btn-block" type="submit">Simpan</button>' +
      '</form></div>'
    )
    $('#f-kas [name=rekening]').val(kas.rekening)
    $('#f-kas [name=kas_bulan_lalu]').val(kas.kas_bulan_lalu)
    $('#f-kas [name=pendapatan]').val(kas.pendapatan)
    $('#f-kas [name=pengeluaran]').val(kas.pengeluaran)

    function updateSaldo() {
      var saldo = (Number($('#f-kas [name=kas_bulan_lalu]').val()) || 0) +
        (Number($('#f-kas [name=pendapatan]').val()) || 0) -
        (Number($('#f-kas [name=pengeluaran]').val()) || 0)
      $('#kas-saldo-nilai').text(app.formatRupiah(saldo))
    }
    updateSaldo()
    $('#f-kas input').on('input', updateSaldo)

    $('#f-kas').on('submit', function (e) {
      e.preventDefault()
      app.api('formSave', {
        formId: 'kas', index: 'no-index',
        active: $('[name=active]').is(':checked') ? '1' : '0',
        rekening: $('[name=rekening]').val(),
        kas_bulan_lalu: $('[name=kas_bulan_lalu]').val() || '0',
        pendapatan: $('[name=pendapatan]').val() || '0',
        pengeluaran: $('[name=pengeluaran]').val() || '0'
      }).done(function (res) {
        if (res.success) { app.toast('success', 'Kas masjid tersimpan'); app.refresh() }
        else app.toast('danger', res.data)
      })
    })
  }

  // Offline fallback: province list scraped from the Kemenag site (value = the
  // real hash ID). Only used when the kemenagProvinsi endpoint fails (offline);
  // while online the list is always loaded from the site so it never goes stale.
  var PROVINSI_FALLBACK = [
    ['c4ca4238a0b923820dcc509a6f75849b', 'ACEH'],
    ['c81e728d9d4c2f636f067f89cc14862c', 'SUMATERA UTARA'],
    ['eccbc87e4b5ce2fe28308fd9f2a7baf3', 'SUMATERA BARAT'],
    ['a87ff679a2f3e71d9181a67b7542122c', 'RIAU'],
    ['e4da3b7fbbce2345d7772b0674a318d5', 'KEPULAUAN RIAU'],
    ['1679091c5a880faf6fb5e6087eb1b2dc', 'JAMBI'],
    ['8f14e45fceea167a5a36dedd4bea2543', 'BENGKULU'],
    ['c9f0f895fb98ab9159f51fd0297e236d', 'SUMATERA SELATAN'],
    ['45c48cce2e2d7fbdea1afc51c7c6ad26', 'KEPULAUAN BANGKA BELITUNG'],
    ['d3d9446802a44259755d38e6d163e820', 'LAMPUNG'],
    ['6512bd43d9caa6e02c990b0a82652dca', 'BANTEN'],
    ['c20ad4d76fe97759aa27a0c99bff6710', 'JAWA BARAT'],
    ['c51ce410c124a10e0db5e4b97fc2af39', 'DKI JAKARTA'],
    ['aab3238922bcc25a6f606eb525ffdc56', 'JAWA TENGAH'],
    ['9bf31c7ff062936a96d3c8bd1f8f2ff3', 'D.I. YOGYAKARTA'],
    ['c74d97b01eae257e44aa9d5bade97baf', 'JAWA TIMUR'],
    ['70efdf2ec9b086079795c442636b55fb', 'BALI'],
    ['6f4922f45568161a8cdf4ad2299f6d23', 'NUSA TENGGARA BARAT'],
    ['1f0e3dad99908345f7439f8ffabdffc4', 'NUSA TENGGARA TIMUR'],
    ['98f13708210194c475687be6106a3b84', 'KALIMANTAN BARAT'],
    ['3c59dc048e8850243be8079a5c74d079', 'KALIMANTAN SELATAN'],
    ['b6d767d2f8ed5d21a44b0e5886680cb9', 'KALIMANTAN TENGAH'],
    ['37693cfc748049e45d87b8c7d8b9aacd', 'KALIMANTAN TIMUR'],
    ['1ff1de774005f8da13f42943881c655f', 'KALIMANTAN UTARA'],
    ['8e296a067a37563370ded05f5a3bf3ec', 'GORONTALO'],
    ['4e732ced3463d06de0ca9a15b6153677', 'SULAWESI SELATAN'],
    ['02e74f10e0327ad868d138f2b4fdd6f0', 'SULAWESI TENGGARA'],
    ['33e75ff09dd601bbe69f351039152189', 'SULAWESI TENGAH'],
    ['6ea9ab1baa0efb9e19094440c317e21b', 'SULAWESI UTARA'],
    ['34173cb38f07f89ddbebc2ac9128303f', 'SULAWESI BARAT'],
    ['c16a5320fa475530d9583c34fd356ef5', 'MALUKU'],
    ['6364d3f0f495b6ab9dcf8d3b5c6e0b01', 'MALUKU UTARA'],
    ['182be0c5cdcd5072bb1864cdee4d3d6e', 'PAPUA'],
    ['e369853df766fa44e1ed0ff613f563bd', 'PAPUA BARAT'],
    ['3416a75f4cea9109507cacd8e2f2aefc', 'PUSAT'],
    ['a1d0c6e83f027327d8461063f4ac58a6', 'PAPUA SELATAN'],
    ['17e62166fc8586dfa4d1bc0e1742c08b', 'PAPUA TENGAH'],
    ['f7177163c833dff4b38fc8d2872f1ec6', 'PAPUA PEGUNUNGAN']
  ]

  function provinsiOptions(list, selected) {
    return list.map(function (p) {
      return '<option value="' + p.value + '"' + (p.value === selected ? ' selected' : '') + '>' + p.label + '</option>'
    }).join('')
  }

  function muatProvinsi($sel, selected, onLoaded) {
    app.api('kemenagProvinsi').done(function (res) {
      if (res.success && res.data && res.data.length) {
        $sel.html(provinsiOptions(res.data, selected))
      } else {
        // Offline: fall back to the snapshot list (the site may have changed)
        $sel.html(provinsiOptions(PROVINSI_FALLBACK, selected))
      }
      if (onLoaded) onLoaded()
    }).fail(function () {
      $sel.html(provinsiOptions(PROVINSI_FALLBACK, selected))
      if (onLoaded) onLoaded()
    })
  }

  // ------------------------------------------------ Kemenag official schedule
  app.pages['kemenag'] = function () {
    setHeader('Jadwal resmi Kemenag', true)
    var k = app.db.kemenag || { active: false, provid: '', kabkotid: '', last_sync: '' }
    var jadwalCount = Object.keys(app.db.jadwal_resmi || {}).length
    $c().html(
      '<div class="card"><form id="f-kemenag">' +
      toggleRow('Aktifkan sinkron otomatis', 'active', isOn(k.active)) +
      '<div class="field"><label>Provinsi</label><select class="input" name="provid">' +
      '<option value="">memuat…</option>' +
      '</select></div>' +
      '<div class="field"><label>Kabupaten/Kota</label><select class="input" name="kabkotid">' +
      '<option value="">— pilih provinsi dulu —</option>' +
      '</select></div>' +
      '<p class="field-note">Daftar kabupaten/kota dimuat otomatis (butuh internet). ' +
      'Saat aktif dan PC online, jadwal resmi menggantikan perhitungan lokal; saat offline display tetap jalan normal.</p>' +
      '<button class="btn btn-primary btn-block" type="submit">Simpan</button>' +
      '</form></div>' +
      '<div class="card">' +
      '<div class="field"><label>Status sinkron</label>' +
      '<p class="field-note" id="kemenag-status">' +
      (k.last_sync ? 'Terakhir: ' + new Date(k.last_sync).toLocaleString('id-ID') : 'Belum pernah sinkron') +
      ' · ' + jadwalCount + ' hari tersimpan</p></div>' +
      '<button class="btn btn-primary btn-block" id="btn-sync-kemenag" type="button">Sinkron Sekarang</button>' +
      '<p class="field-note">Butuh koneksi internet. Display akan reload otomatis setelah sinkron berhasil.</p>' +
      '</div>'
    )
    // Load provinces first; regencies are fetched ONLY AFTER the province list
    // is ready (fetching earlier leaves val() empty → regencies never load).
    $('#f-kemenag [name=provid]').on('change', function () {
      var provid = $(this).val()
      var $kab = $('#f-kemenag [name=kabkotid]')
      if (!provid) {
        $kab.html('<option value="">— pilih provinsi dulu —</option>')
        return
      }
      $kab.html('<option value="">memuat…</option>')
      app.api('kemenagKabkota', { provid: provid }).done(function (res) {
        if (res.success && res.data && res.data.length) {
          var opts = '<option value="">— pilih kabupaten/kota —</option>' + res.data.map(function (o) {
            return '<option value="' + o.value + '"' + (o.value === k.kabkotid ? ' selected' : '') + '>' + o.label + '</option>'
          }).join('')
          $kab.html(opts)
        } else {
          $kab.html('<option value="">(gagal memuat, cek internet)</option>')
          if (res.data) app.toast('danger', res.data)
        }
      })
    })
    muatProvinsi($('#f-kemenag [name=provid]'), k.provid, function () {
      // Regencies are fetched ONLY AFTER the province list is ready (fetching
      // earlier leaves val() empty → regencies never load).
      if (k.provid) $('#f-kemenag [name=provid]').trigger('change')
    })
    $('#f-kemenag').on('submit', function (e) {
      e.preventDefault()
      app.api('formSave', {
        formId: 'kemenag', index: 'no-index',
        active: $('#f-kemenag [name=active]').is(':checked') ? '1' : '0',
        provid: $('#f-kemenag [name=provid]').val(),
        kabkotid: $('#f-kemenag [name=kabkotid]').val(),
        last_sync: k.last_sync || ''
      }).done(function (res) {
        if (res.success) { app.toast('success', 'Pengaturan Kemenag tersimpan'); app.refresh() }
        else app.toast('danger', res.data)
      })
    })
    $('#btn-sync-kemenag').on('click', function () {
      var $btn = $(this)
      $btn.prop('disabled', true).text('Menyinkronkan...')
      app.api('syncKemenag').done(function (res) {
        if (res.success && res.data) {
          app.toast('success', 'Sinkron OK: ' + res.data.synced + ' hari')
          app.refresh()
        } else {
          app.toast('danger', res.data || 'Sinkron gagal')
        }
      }).fail(function () {
        app.toast('danger', 'Gagal menghubungi server')
      }).always(function () {
        $btn.prop('disabled', false).text('Sinkron Sekarang')
      })
    })
  }

  // ------------------------------------------------ change password
  app.pages['password'] = function () {
    setHeader('Ganti password', true)
    // Password default (admin1234) belum diganti → tampilkan peringatan keras.
    var defaultAktif = !String((app.db.akses && app.db.akses.pass) || '').trim()
    $c().html(
      '<div class="card">' +
      (defaultAktif
        ? '<p class="field-note" style="color:#b91c1c;font-weight:600">' +
          'Password default masih aktif. Segera ganti sebelum display dipakai.</p>'
        : '') +
      '<form id="f-pass">' +
      field('Password lama', 'password_lama', '', { type: 'password', maxlength: 64 }) +
      field('Password baru', 'password_baru', '', { type: 'password', maxlength: 64 }) +
      field('Ulangi password baru', 'ulangi_password_baru', '', { type: 'password', maxlength: 64 }) +
      '<p class="field-note">Minimal 8 karakter. Jangan gunakan admin1234.</p>' +
      '<button class="btn btn-danger btn-block" type="submit">Ganti password</button>' +
      '</form></div>'
    )
    $('#f-pass').on('submit', function (e) {
      e.preventDefault()
      app.api('formSave', {
        formId: 'gantiPass', index: 'no-index',
        password_lama: $('[name=password_lama]').val(),
        password_baru: $('[name=password_baru]').val(),
        ulangi_password_baru: $('[name=ulangi_password_baru]').val()
      }).done(function (res) {
        if (res.success) { app.toast('success', 'Password diganti'); app.refresh() }
        else app.toast('danger', res.data)
      })
    })
  }

  // ------------------------------------------------ remote (Tailscale)
  // Kelola email pengurus (admin tambahan). Daftar disimpan di db.tailscale
  // dan diterapkan ke ACL tailnet lewat handler tailscaleSetup (lokal saja).
  app.pages['remote'] = function () {
    setHeader('Remote (Tailscale)', true)
    var emails = ((app.db.tailscale && app.db.tailscale.pengurus_emails) || []).join(', ')
    $c().html(
      '<div class="card">' +
      '<p class="field-note">Bagian ini mengatur siapa saja yang bisa membuka halaman admin ' +
      'dari jarak jauh. Isi email pengurus di bawah — boleh lebih dari satu, pisahkan dengan koma.</p>' +
      '<form id="f-remote">' +
      field('Email pengurus', 'emails', emails,
        { placeholder: 'pengurus1@gmail.com, pengurus2@gmail.com', required: false, maxlength: 500 }) +
      '<p class="field-note">Hp/laptop pengurus harus sudah terpasang aplikasi Tailscale dan login ' +
      'dengan email tersebut, lalu buka alamat admin seperti biasa.</p>' +
      '<button class="btn btn-primary btn-block" type="submit">Simpan</button>' +
      '</form></div>' +
      '<div class="card">' +
      '<p class="field-note"><b>Pengaturan pertama kali (untuk teknisi):</b><br>' +
      '1. Di situs Tailscale, matikan kedaluwarsa kunci perangkat STB ini ' +
      '(Machines → STB → "..." → Disable key expiry).<br>' +
      '2. Agar tidak perlu diulang tiap beberapa bulan, buat OAuth client ' +
      '(Settings → OAuth clients), lalu isi TS_CLIENT_ID dan TS_CLIENT_SECRET di file .env dan restart.<br>' +
      '3. Tanpa itu, server hanya menyiapkan file db/tailscale-acl.json — ' +
      'salin isinya ke menu Access Controls di situs Tailscale lalu simpan.</p>' +
      '</div>'
    )
    $('#f-remote').on('submit', function (e) {
      e.preventDefault()
      var $btn = $(this).find('button[type=submit]').prop('disabled', true).text('Menerapkan...')
      app.api('tailscaleSetup', { emails: $('[name=emails]').val() }).done(function (res) {
        if (res.success) {
          app.toast('success', 'Pengaturan tersimpan (' + ((res.data && res.data.applied) || 0) + ' email)')
          app.refresh()
        } else {
          app.toast('danger', res.data)
        }
      }).always(function () {
        $btn.prop('disabled', false).text('Simpan')
      })
    })

    // --- Quick Tunnel (akses publik sementara) -------------------------------
    var $card = $(
      '<div class="card"><div id="qt-body">' +
      '<p class="field-note">Memuat status akses publik...</p></div></div>'
    ).appendTo($c())

    var pollingQt = null
    function stopPollingQt() {
      if (pollingQt) { clearInterval(pollingQt); pollingQt = null }
    }

    function salinUrl(url, $btn) {
      var ikonAsli = $btn.html()
      function sukses() {
        $btn.html('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
          'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>')
        setTimeout(function () { $btn.html(ikonAsli) }, 1500)
      }
      function fallback() {
        // HTTP (non-HTTPS) tidak punya clipboard API — pakai cara lama.
        var $tmp = $('<textarea>').val(url).css({ position: 'fixed', opacity: 0 }).appendTo('body')
        $tmp[0].select()
        try { document.execCommand('copy') ? sukses() : app.toast('danger', 'Gagal menyalin — salin manual') }
        catch (e) { app.toast('danger', 'Gagal menyalin — salin manual') }
        $tmp.remove()
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(sukses, fallback)
      } else fallback()
    }

    function renderTunnel(st) {
      var aktif = st && st.running
      var html =
        '<p class="field-note"><b>Akses publik sementara.</b><br>' +
        '<p class="field-note">Saat aktif, halaman display dan admin bisa dibuka dari mana saja lewat ' +
        'sebuah link. Link berubah setiap kali dinyalakan dan mati otomatis saat server direstart.</p>'
      if (aktif && st.url) {
        stopPollingQt()
        html += '<div class="field"><label>Link publik aktif</label>' +
          '<div style="display:flex;align-items:stretch;gap:6px">' +
          '<input class="input" id="qt-url" readonly value="' + st.url + '" ' +
          'style="flex:1;min-width:0;font-size:13px" onclick="this.select()">' +
          '<button class="btn btn-primary" id="btn-qt-copy" type="button" title="Salin link" ' +
          'style="flex:0 0 auto;width:44px;padding:0;display:flex;align-items:center;justify-content:center">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
          'stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/>' +
          '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
          '</button></div></div>' +
          '<p class="field-note">Bagikan link ini ke yang perlu melihat display. ' +
          '<b>Halaman admin tetap membutuhkan password</b> — jangan bagikan password.</p>'
      } else if (aktif) {
        html += '<p class="field-note" id="qt-waiting">Menyalakan, menunggu link dari server…</p>' +
          '<p class="field-note"><span class="qt-dots">⏳</span> biasanya 5–15 detik; halaman ini tidak perlu dimuat ulang.</p>'
      }
      if (st && st.error) {
        html += '<p class="field-note" style="color:#b91c1c">Error: ' + st.error + '</p>'
      }
      if (st && !aktif && st.log && /not found|ENOENT/.test(st.log)) {
        html += '<p class="field-note" style="color:#b91c1c">Program penghubung (cloudflared) belum terpasang di STB. ' +
          'Minta teknisi memasangnya: sudo bash scripts/install.sh</p>'
      }
      html += '<button class="btn ' + (aktif ? 'btn-danger' : 'btn-primary') + ' btn-block" id="btn-qt">' +
        (aktif ? 'Matikan akses publik' : 'Nyalakan akses publik') + '</button>'
      $card.find('#qt-body').html(html)

      $('#btn-qt-copy').on('click', function () {
        salinUrl($('#qt-url').val(), $(this))
      })

      $('#btn-qt').on('click', function () {
        var $btn = $(this).prop('disabled', true).text(aktif ? 'Mematikan...' : 'Mengaktifkan...')
        app.api(aktif ? 'quickTunnelStop' : 'quickTunnelStart').done(function (res) {
          if (!res.success) {
            app.toast('danger', res.data)
            $btn.prop('disabled', false).text(aktif ? 'Matikan akses publik' : 'Aktifkan akses publik')
            return
          }
          if (aktif) {
            stopPollingQt()
            app.toast('success', 'Akses publik dimatikan')
            muatStatus()
          } else {
            app.toast('success', 'Akses publik dinyalakan — link akan muncul otomatis di sini')
            // Langsung tampilkan status "menunggu", lalu poll tiap 2 detik
            // sampai URL keluar (atau tunnel mati). Maks 60 detik.
            renderTunnel({ running: true, url: '' })
            stopPollingQt()
            var n = 0
            pollingQt = setInterval(function () {
              if (++n > 30) { stopPollingQt(); return }
              app.api('quickTunnelStatus').done(function (r) {
                if (!r.success) return
                var d = r.data || {}
                if (d.url || !d.running) { renderTunnel(d) }
              })
            }, 2000)
          }
        })
      })
    }

    function muatStatus() {
      app.api('quickTunnelStatus').done(function (res) {
        if (res.success) {
          renderTunnel(res.data)
          // Halaman dibuka saat tunnel menyala tapi URL belum keluar → ikut polling.
          if (res.data && res.data.running && !res.data.url && !pollingQt) {
            var n = 0
            pollingQt = setInterval(function () {
              if (++n > 30) { stopPollingQt(); return }
              app.api('quickTunnelStatus').done(function (r) {
                if (!r.success) return
                var d = r.data || {}
                if (d.url || !d.running) renderTunnel(d)
              })
            }, 2000)
          }
        } else {
          $card.find('#qt-body').html('<p class="field-note">' + res.data + '</p>')
        }
      })
    }
    muatStatus()
  }

  // ------------------------------------------------ WiFi (lokal saja)
  // Pindai, sambung, dan kelola profil melalui NetworkManager (nmcli).
  // Pergantian jaringan memakai masa uji 120 dtk: bila admin tidak menekan
  // "Konfirmasi", server mengembalikan konfigurasi lama otomatis supaya STB
  // tidak hilang dari jaringan (termasuk Tailscale).
  app.pages['wifi'] = function () {
    setHeader('WiFi', true)

    var polling = null
    var countdown = null
    var tokenAktif = null
    // Tanda koneksi WiFi terakhir; dipakai polling untuk mendeteksi perubahan
    // (mis. tersambung dari luar halaman ini) lalu menyegarkan daftar otomatis.
    var sigKoneksi = ''
    var muatScanTerakhir = 0

    function stopPolling() {
      if (polling) { clearInterval(polling); polling = null }
      if (countdown) { clearInterval(countdown); countdown = null }
    }
    $(window).off('hashchange.wifi').on('hashchange.wifi', stopPolling)

    $c().html(
      '<div class="card" id="wifi-status"><p class="field-note">Memuat status jaringan...</p></div>' +
      '<div class="card" id="wifi-trial" style="display:none"></div>' +
      '<div class="card">' +
      '<div class="field"><label>WiFi di sekitar</label>' +
      '<p class="field-note">Ketuk nama jaringan untuk memasukkan password. ' +
      'Jaringan tersembunyi bisa diisi manual di bawah.</p></div>' +
      '<div id="wifi-scan" class="wifi-list"><p class="field-note">Memindai...</p></div>' +
      '<button class="btn btn-primary btn-block" id="btn-wifi-rescan" type="button">Pindai ulang</button>' +
      '</div>' +
      '<div class="card">' +
      '<div class="field"><label>SSID tersembunyi / manual</label>' +
      '<p class="field-note">Untuk jaringan yang tidak muncul di daftar.</p></div>' +
      '<form id="f-wifi-manual">' +
      field('Nama jaringan (SSID)', 'wifi_ssid_manual', '', { maxlength: 32, required: false, placeholder: 'Nama WiFi' }) +
      field('Password', 'wifi_pass_manual', '', { type: 'password', maxlength: 63, required: false, placeholder: 'Kosongkan bila terbuka' }) +
      '<button class="btn btn-primary btn-block" type="submit">Simpan &amp; sambung</button>' +
      '</form>' +
      '</div>' +
      '<div class="card">' +
      '<div class="field"><label>Profil tersimpan</label>' +
      '<p class="field-note">Profil dengan prioritas utama dipilih lebih dulu saat STB menyala.</p></div>' +
      '<div id="wifi-profiles"><p class="field-note">Memuat profil...</p></div>' +
      '</div>'
    )

    // --- status -------------------------------------------------------------
    // Sidik koneksi: berubah saat SSID/status WiFi berganti.
    function sidikKoneksi(st) {
      var w = (st && st.wlan) || {}
      return (w.terhubung ? '1' : '0') + '|' + (w.ssid || '') + '|' + (w.ip || '') +
        '|' + ((st && st.ethernet && st.ethernet.terhubung) ? '1' : '0') + '|' + ((st && st.internet) ? '1' : '0')
    }

    function renderStatus(st) {
      if (!st) return
      var w = st.wlan || {}
      var e = st.ethernet || {}
      var t = st.tailscale || {}
      var html =
        '<div class="field"><label>Status jaringan</label>' +
        '<p class="field-note">' +
        'Kabel: ' + (e.terhubung ? 'tersambung' + (e.ip ? ' · ' + esc(e.ip) : '') : 'tidak tersambung') + '<br>' +
        'WiFi: ' + (w.terhubung
          ? esc(w.ssid || 'tersambung') + (w.sinyal ? ' · sinyal ' + w.sinyal + '%' : '') + (w.ip ? ' · ' + esc(w.ip) : '')
          : 'tidak tersambung') + '<br>' +
        'Tailscale: ' + (t.aktif ? esc(t.ip) : 'belum aktif') + '<br>' +
        'Internet: ' + (st.internet ? 'tersedia' : 'tidak tersedia') +
        '</p></div>'
      $('#wifi-status').html(html)
    }

    function renderTrial(tr) {
      var $box = $('#wifi-trial')
      if (!tr || !tr.aktif) {
        tokenAktif = null
        $box.hide().empty()
        return
      }
      tokenAktif = tr.token
      $box.show().html(
        '<div class="field"><label>Uji koneksi — konfirmasi diperlukan</label>' +
        '<p class="field-note">WiFi <b>' + esc(tr.ssidBaru) + '</b> baru saja dipakai. ' +
        'Bila halaman ini tetap terbuka, tekan Konfirmasi. Tanpa konfirmasi, ' +
        'pengaturan dikembalikan ke <b>' + esc(tr.ssidLama || 'koneksi sebelumnya') + '</b> dalam ' +
        '<span id="wifi-sisa">' + (tr.sisaDetik || 0) + '</span> detik.</p></div>' +
        '<div class="btn-row">' +
        '<button class="btn btn-primary" id="btn-trial-ok" type="button">Konfirmasi</button>' +
        '<button class="btn btn-ghost" id="btn-trial-cancel" type="button">Batalkan</button>' +
        '</div>'
      )
      if (countdown) clearInterval(countdown)
      var sisa = Number(tr.sisaDetik) || 0
      countdown = setInterval(function () {
        sisa = Math.max(0, sisa - 1)
        var $s = $('#wifi-sisa')
        if (!$s.length) { clearInterval(countdown); countdown = null; return }
        $s.text(sisa)
        if (sisa === 0) { clearInterval(countdown); countdown = null; muatStatus() }
      }, 1000)

      $('#btn-trial-ok').on('click', function () {
        var $btn = $(this).prop('disabled', true).text('Menyimpan...')
        app.api('wifiTrialConfirm', { token: tr.token }).done(function (res) {
          if (res.success) {
            app.toast('success', 'WiFi ' + (res.data.ssid || '') + ' tersimpan')
            segarkanSemua()
          } else {
            app.toast('danger', res.data)
            $btn.prop('disabled', false).text('Konfirmasi')
          }
        })
      })
      $('#btn-trial-cancel').on('click', function () {
        var $btn = $(this).prop('disabled', true).text('Mengembalikan...')
        app.api('wifiTrialCancel', { token: tr.token }).done(function (res) {
          if (res.success) app.toast('success', 'Koneksi dikembalikan')
          else app.toast('danger', res.data)
          segarkanSemua()
        }).always(function () { $btn.prop('disabled', false).text('Batalkan') })
      })
    }

    // Terapkan status + deteksi perubahan koneksi. Bila WiFi/ethernet/internet
    // berubah (termasuk karena tersambung dari tempat lain), daftar jaringan
    // dan profil ikut disegarkan otomatis tanpa perlu muat ulang halaman.
    function terapkanStatus(st) {
      renderStatus(st)
      renderTrial(st.trial)
      var sig = sidikKoneksi(st)
      if (sigKoneksi && sig !== sigKoneksi) {
        muatScan()
        muatProfil()
      }
      sigKoneksi = sig
    }

    function muatStatus() {
      app.api('wifiStatus').done(function (res) {
        if (!res.success) {
          $('#wifi-status').html('<p class="field-note">' + esc(res.data) + '</p>')
          $('#wifi-scan').html('')
          $('#wifi-profiles').html('')
          return
        }
        terapkanStatus(res.data)
      }).fail(function () {
        $('#wifi-status').html('<p class="field-note">Gagal menghubungi server.</p>')
      })
    }

    // Segarkan ketiga kartu sekaligus (status, daftar jaringan, profil).
    // Dipakai setelah aksi yang mengubah koneksi agar UI langsung berganti.
    function segarkanSemua() {
      muatStatus()
      muatScan()
      muatProfil()
    }

    // --- pindai -------------------------------------------------------------
    function sambung(ssid, password, hidden, terbuka, $btn) {
      var teks = $btn.text()
      $btn.prop('disabled', true).text('Menyambung...')
      app.api('wifiConnect', { ssid: ssid, password: password, hidden: hidden ? '1' : '0', terbuka: terbuka ? '1' : '0' })
        .done(function (res) {
          if (!res.success) { app.toast('danger', res.data); $btn.prop('disabled', false).text(teks); return }
          app.toast('success', 'Tersambung ke ' + (res.data.ssid || ssid))
          // Daftar ikut dirender ulang: baris SSID berubah jadi "terhubung"
          // dan form password yang terbuka otomatis tertutup.
          segarkanSemua()
        })
        .fail(function () { app.toast('danger', 'Gagal menghubungi server'); $btn.prop('disabled', false).text(teks) })
    }

    function renderScan(list) {
      var $box = $('#wifi-scan')
      if (!list || !list.length) {
        $box.html('<p class="field-note">Tidak ada jaringan ditemukan.</p>')
        return
      }
      // Daftar ringkas: password TIDAK dirender untuk semua baris. Form baru
      // muncul setelah salah satu SSID diketuk (dan hanya satu yang terbuka).
      $box.html(list.map(function (j, i) {
        var status = j.aktif ? 'terhubung'
          : (j.terbuka ? 'terbuka' : (j.keamanan || 'terkunci'))
        return '<div class="wifi-item' + (j.aktif ? ' is-active' : '') + '" data-i="' + i + '">' +
          '<button type="button" class="wifi-item-head">' +
          '<span class="wifi-item-text">' +
          '<span class="wifi-item-name">' + esc(j.ssid) + '</span>' +
          '<span class="wifi-item-meta">' + esc(status) + '</span>' +
          '</span>' +
          '<span class="wifi-item-right">' +
          '<span class="wifi-signal">' + j.sinyal + '%</span>' +
          '<span class="wifi-chevron">&#8250;</span>' +
          '</span>' +
          '</button>' +
          '<div class="wifi-item-form" style="display:none">' +
          (j.aktif
            ? '<p class="field-note">Perangkat sudah terhubung ke jaringan ini.</p>'
            : (j.terbuka
              ? '<p class="field-note">Jaringan terbuka — tanpa password.</p>'
              : '<div class="field"><label>Password</label>' +
                '<div class="pass-wrap"><input class="input wifi-pass-input" type="password" ' +
                'placeholder="Password WiFi" maxlength="63" autocomplete="new-password">' +
                eyeToggleHtml() + '</div></div>') +
              '<div class="btn-row">' +
              '<button class="btn btn-sm btn-primary btn-wifi-connect" type="button">Sambung</button>' +
              '<button class="btn btn-sm btn-ghost btn-wifi-close" type="button">Batal</button>' +
              '</div>') +
          '</div></div>'
      }).join(''))

      function tutupSemua() {
        $box.find('.wifi-item').removeClass('is-open')
        $box.find('.wifi-item-form').hide()
      }

      $box.find('.wifi-item-head').on('click', function () {
        var $item = $(this).closest('.wifi-item')
        var terbuka = $item.hasClass('is-open')
        tutupSemua()
        if (terbuka) return
        $item.addClass('is-open')
        $item.find('.wifi-item-form').show()
        $item.find('.wifi-pass-input').trigger('focus')
      })

      $box.find('.btn-wifi-close').on('click', function () {
        tutupSemua()
      })

      $box.find('.btn-wifi-connect').on('click', function () {
        var $item = $(this).closest('.wifi-item')
        var j = list[Number($item.data('i'))]
        sambung(j.ssid, $item.find('.wifi-pass-input').val(), false, j.terbuka, $(this))
      })
    }

    function muatScan() {
      // Dedupe: segarkanSemua() + deteksi perubahan koneksi bisa memicu
      // pemindaian ganda dalam satu momen. Rescan mahal (~1-5 dtk), jadi
      // permintaan kedua dalam 1 detik dilewati.
      var now = Date.now()
      if (now - muatScanTerakhir < 1000) return
      muatScanTerakhir = now
      $('#wifi-scan').html('<p class="field-note">Memindai...</p>')
      app.api('wifiScan').done(function (res) {
        if (res.success) renderScan(res.data.jaringan)
        else $('#wifi-scan').html('<p class="field-note">' + esc(res.data) + '</p>')
      }).fail(function () {
        $('#wifi-scan').html('<p class="field-note">Gagal memindai.</p>')
      })
    }

    // --- profil -------------------------------------------------------------
    function renderProfil(list) {
      var $box = $('#wifi-profiles')
      if (!list || !list.length) {
        $box.html('<p class="field-note">Belum ada profil WiFi tersimpan.</p>')
        return
      }
      $box.html(list.map(function (p, i) {
        return '<div class="list-card wifi-profile" data-i="' + i + '">' +
          '<div class="list-card-head">' +
          '<span class="list-card-title">' + esc(p.ssid || p.nama) + (p.aktif ? ' · aktif' : '') + '</span>' +
          (p.prioritas > 0 ? '<span class="wifi-priority">utama</span>' : '') +
          '</div>' +
          '<div class="switch-row"><span class="switch-label">Sambung otomatis</span>' +
          '<span class="switch"><input type="checkbox" class="wifi-auto"' + (p.autoconnect ? ' checked' : '') + '>' +
          '<span class="track"></span></span></div>' +
          '<div class="btn-row">' +
          (p.aktif ? '' : '<button class="btn btn-sm btn-primary btn-wifi-use" type="button">Sambung</button>') +
          '<button class="btn btn-sm btn-ghost btn-wifi-main" type="button">Jadikan utama</button>' +
          '<button class="btn btn-sm btn-danger btn-wifi-del" type="button">Hapus</button>' +
          '</div></div>'
      }).join(''))

      $box.find('.wifi-auto').on('change', function () {
        var p = list[Number($(this).closest('.wifi-profile').data('i'))]
        var $el = $(this)
        app.api('wifiProfile', { uuid: p.uuid, action: 'autoconnect', nilai: $el.is(':checked') ? '1' : '0' })
          .done(function (res) {
            if (!res.success) { app.toast('danger', res.data); $el.prop('checked', !$el.is(':checked')) }
            else app.toast('success', 'Pengaturan disimpan')
          })
      })
      $box.find('.btn-wifi-use').on('click', function () {
        var p = list[Number($(this).closest('.wifi-profile').data('i'))]
        var $btn = $(this).prop('disabled', true).text('Menyambung...')
        app.api('wifiProfile', { uuid: p.uuid, action: 'activate' }).done(function (res) {
          if (!res.success) { app.toast('danger', res.data); $btn.prop('disabled', false).text('Sambung'); return }
          app.toast('success', 'Tersambung ke ' + (p.ssid || p.nama))
          segarkanSemua()
        })
      })
      $box.find('.btn-wifi-main').on('click', function () {
        var p = list[Number($(this).closest('.wifi-profile').data('i'))]
        var $btn = $(this).prop('disabled', true).text('Menyimpan...')
        app.api('wifiProfile', { uuid: p.uuid, action: 'utama' }).done(function (res) {
          if (!res.success) { app.toast('danger', res.data); $btn.prop('disabled', false).text('Jadikan utama'); return }
          app.toast('success', 'Profil utama diperbarui')
          muatProfil()
        })
      })
      $box.find('.btn-wifi-del').on('click', function () {
        var p = list[Number($(this).closest('.wifi-profile').data('i'))]
        var $btn = $(this)
        if (!$btn.data('confirm')) {
          $btn.data('confirm', true).text('Ketuk lagi')
          setTimeout(function () { $btn.data('confirm', false).text('Hapus') }, 4000)
          return
        }
        app.api('wifiProfile', { uuid: p.uuid, action: 'delete' }).done(function (res) {
          if (!res.success) app.toast('danger', res.data)
          else app.toast('success', 'Profil dihapus')
          muatProfil()
        })
      })
    }

    function muatProfil() {
      $('#wifi-profiles').html('<p class="field-note">Memuat profil...</p>')
      app.api('wifiProfiles').done(function (r) {
        if (r.success) renderProfil(r.data.profil)
        else $('#wifi-profiles').html('<p class="field-note">' + esc(r.data) + '</p>')
      }).fail(function () {
        $('#wifi-profiles').html('<p class="field-note">Gagal memuat profil.</p>')
      })
    }

    $('#btn-wifi-rescan').on('click', muatScan)
    $('#f-wifi-manual').on('submit', function (e) {
      e.preventDefault()
      var ssid = $('[name=wifi_ssid_manual]').val()
      var pass = $('[name=wifi_pass_manual]').val()
      if (!String(ssid || '').trim()) { app.toast('warning', 'SSID wajib diisi'); return }
      sambung(ssid, pass, true, !pass, $(this).find('button[type=submit]'))
    })

    muatStatus()
    muatScan()
    muatProfil()

    // Polling ringan: status + trial (hanya saat halaman ini terbuka).
    // Lewat terapkanStatus() agar daftar jaringan/profil ikut berganti sendiri
    // begitu WiFi tersambung (atau putus) tanpa campur tangan pengguna.
    polling = setInterval(function () {
      if (!$('#wifi-status').length) { stopPolling(); return }
      app.api('wifiStatus').done(function (res) {
        if (!res.success) return
        terapkanStatus(res.data)
      })
    }, 5000)
  }

  // ------------------------------------------------ update sistem (lokal saja)
  // Meluncurkan scripts/update.sh di server lokal (STB) dan mem-poll log-nya.
  // Di Workers: server menolak dengan pesan lokal-only → halaman menampilkan
  // keterangan tersebut.
  app.pages['update'] = function () {
    setHeader('Update sistem', true)
    $c().html(
      '<div class="card">' +
      '<div class="field"><label>Perbarui kode aplikasi</label>' +
      '<p class="field-note">' +
      'Mengambil versi terbaru dari repositori, memasang dependensi, lalu ' +
      'merestart service. Backup db/.env dibuat otomatis. ' +
      '<strong>Jalankan di luar jam sholat</strong> — display akan memuat ulang.' +
      '</p></div>' +
      '<button class="btn btn-primary btn-block" id="btn-update">Perbarui sekarang</button>' +
      '<pre id="update-log" class="input" style="display:none;white-space:pre-wrap;height:220px;overflow:auto;margin-top:12px;font-size:12px"></pre>' +
      '<p class="field-note" id="update-done" style="display:none;margin-top:8px">' +
      'Update selesai. Server me-restart — muat ulang halaman ini.</p>' +
      '</div>'
    )

    var polling = null
    function renderLog() {
      app.api('updateStatus').done(function (res) {
        if (!res.success) return
        var d = res.data || {}
        if (d.log) {
          var $log = $('#update-log').show()
          $log.text(d.log)
          $log.scrollTop($log.prop('scrollHeight'))
        }
        if (d.running === false && d.exitCode !== null) {
          clearInterval(polling)
          polling = null
          $('#update-done').show()
        }
      }).fail(function () {
        // Server sedang restart → log tidak terjangkau; anggap selesai
        if (polling) {
          clearInterval(polling)
          polling = null
          $('#update-done').show()
        }
      })
    }

    $('#btn-update').on('click', function () {
      var $btn = $(this)
      if (!$btn.data('confirm')) {
        $btn.data('confirm', true).text('Ketuk lagi untuk konfirmasi (luar jam sholat)')
        setTimeout(function () {
          $btn.data('confirm', false).text('Perbarui sekarang')
        }, 4000)
        return
      }
      $btn.prop('disabled', true).text('Memulai update...')
      app.api('updateSystem').done(function (res) {
        if (!res.success) {
          app.toast('danger', res.data || 'Gagal memulai update')
          $btn.prop('disabled', false).text('Perbarui sekarang')
          return
        }
        $btn.text('Update berjalan...')
        $('#update-log').show()
        polling = setInterval(renderLog, 2000)
        renderLog()
      }).fail(function () {
        app.toast('danger', 'Gagal menghubungi server')
        $btn.prop('disabled', false).text('Perbarui sekarang')
      })
    })
  }
})()

$(function () { app.init() })
