/* ==========================================================================
   Bios Informática - Core Application Logic
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    // Initialize Mock Database
    initMockDatabase();
    
    // Core Modules Initialization
    initNavigation();
    initOSTracker();
    initScheduler();
    initChatbot();
    initServiceCTAs();
});

/* ==========================================================================
   1. Mock Database System
   ========================================================================== */
function initMockDatabase() {
    const defaultOS = [
        {
            os: "BIOS-8824",
            device: "Notebook Dell Inspiron 15",
            client: "Douglas Silva",
            phone: "(13) 99765-4321",
            status: 4, // Em Reparo
            date: "13/08/2026 às 11:30",
            details: "Substituição do SSD concluída. Realizando testes de estabilidade do sistema e backup de segurança dos dados de usuário."
        },
        {
            os: "BIOS-9102",
            device: "PC Gamer Custom Intel i7 / RTX 4070",
            client: "Mariana Costa",
            phone: "(13) 98122-3344",
            status: 5, // Pronto para Retirada
            date: "12/08/2026 às 16:45",
            details: "Limpeza técnica geral efetuada, troca de pasta térmica do processador por Thermal Grizzly Kryonaut, e testes de estresse em jogos superados com sucesso. Equipamento pronto para retirada."
        },
        {
            os: "BIOS-5432",
            device: "iPhone 13 Pro Max",
            client: "Felipe Almeida",
            phone: "(13) 99611-2233",
            status: 3, // Aguardando Peças
            date: "13/08/2026 às 09:15",
            details: "Identificado curto-circuito na linha secundária de alimentação do display. A nova tela original já foi encomendada junto ao fornecedor e a entrega está prevista para amanhã."
        }
    ];

    if (!localStorage.getItem('bios_os_database')) {
        localStorage.setItem('bios_os_database', JSON.stringify(defaultOS));
    }
}

// Helper to retrieve OS database
function getOSDatabase() {
    return JSON.parse(localStorage.getItem('bios_os_database') || '[]');
}

// Helper to save OS to database
function saveOSToDatabase(newOS) {
    const db = getOSDatabase();
    db.push(newOS);
    localStorage.setItem('bios_os_database', JSON.stringify(db));
}

/* ==========================================================================
   2. Navigation & Header Functionality
   ========================================================================== */
function initNavigation() {
    const navbar = document.getElementById('navbar');
    const mobileToggle = document.getElementById('mobileToggle');
    const navMenu = document.getElementById('navMenu');
    const navItems = document.querySelectorAll('.nav-item');

    // Scroll Effect on Navbar
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
        
        // Active Nav Item on Scroll
        let current = "";
        const sections = document.querySelectorAll('section[id]');
        sections.forEach(section => {
            const sectionTop = section.offsetTop - 120;
            if (window.pageYOffset >= sectionTop) {
                current = section.getAttribute('id');
            }
        });

        navItems.forEach(item => {
            item.classList.remove('active');
            if (item.getAttribute('href').slice(1) === current) {
                item.classList.add('active');
            }
        });
    });

    // Mobile Menu Toggle
    mobileToggle.addEventListener('click', () => {
        navMenu.classList.toggle('open');
        mobileToggle.classList.toggle('active');
    });

    // Close Mobile Menu on Click
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navMenu.classList.remove('open');
            mobileToggle.classList.remove('active');
        });
    });
}

/* ==========================================================================
   3. OS Online Tracking System
   ========================================================================== */
function initOSTracker() {
    const form = document.getElementById('osTrackerForm');
    const input = document.getElementById('osNumberInput');
    const resultsContainer = document.getElementById('osResultsContainer');
    const errorContainer = document.getElementById('osErrorContainer');
    
    // Label DOM targets
    const lblOS = document.getElementById('lblResultOS');
    const lblDevice = document.getElementById('lblResultDevice');
    const lblBadge = document.getElementById('lblResultBadge');
    const lblDate = document.getElementById('lblResultDate');
    const lblDetails = document.getElementById('lblResultDetails');

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const searchVal = input.value.trim().toUpperCase();
        
        if (!searchVal) return;

        const db = getOSDatabase();
        
        // Find by OS number or partial match of client name/phone
        const record = db.find(item => 
            item.os.toUpperCase() === searchVal || 
            item.os.toUpperCase() === `BIOS-${searchVal}` ||
            item.phone.replace(/\D/g, '').includes(searchVal.replace(/\D/g, '')) ||
            item.client.toUpperCase().includes(searchVal)
        );

        if (record) {
            // Fill OS Info
            lblOS.textContent = record.os;
            lblDevice.textContent = record.device;
            lblDate.textContent = record.date;
            lblDetails.textContent = record.details;
            
            // Map Status Labels
            const statusLabels = {
                1: "Equipamento Recebido",
                2: "Em Análise",
                3: "Aguardando Peças",
                4: "Em Manutenção",
                5: "Pronto para Retirada"
            };
            lblBadge.textContent = statusLabels[record.status] || "Em Análise";
            
            // Apply Status Stepper progress
            updateStepper(record.status);
            
            resultsContainer.classList.remove('hidden');
            errorContainer.classList.add('hidden');
            
            // Smooth scroll to results
            resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            resultsContainer.classList.add('hidden');
            errorContainer.classList.remove('hidden');
        }
    });
}

function updateStepper(status) {
    // Reset Stepper
    for (let i = 1; i <= 5; i++) {
        const step = document.getElementById(`step${i}`);
        step.className = "step";
        if (i < 5) {
            const line = document.getElementById(`line${i}`);
            line.className = "step-line";
        }
    }

    // Set classes up to active status
    for (let i = 1; i <= status; i++) {
        const step = document.getElementById(`step${i}`);
        if (i < status) {
            step.classList.add('step-completed');
            // Change inner text to checkmark
            step.querySelector('.step-icon').innerHTML = `
                <svg class="icon-svg-small" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
            `;
            
            if (i < 5) {
                const line = document.getElementById(`line${i}`);
                line.classList.add('line-completed');
            }
        } else if (i === status) {
            step.classList.add('step-active');
            // Set inner to current step number
            step.querySelector('.step-icon').innerHTML = `<span class="step-num">${i}</span>`;
            
            if (i < 5) {
                const line = document.getElementById(`line${i}`);
                line.classList.add('line-active');
            }
        }
    }
}

/* ==========================================================================
   4. Online Scheduling System Dashboard (Calendar & Time picker)
   ========================================================================== */
let calendarCurrentDate = new Date();
let selectedDate = null;
let selectedTime = null;

function initScheduler() {
    const prevBtn = document.getElementById('btnPrevMonth');
    const nextBtn = document.getElementById('btnNextMonth');
    const form = document.getElementById('schedulingForm');
    const overlay = document.getElementById('confirmationOverlay');
    const closeConfBtn = document.getElementById('btnCloseConfirmation');
    const trackOSBtn = document.getElementById('btnGoToTrackOS');

    // Calendar Navigation
    prevBtn.addEventListener('click', () => {
        calendarCurrentDate.setMonth(calendarCurrentDate.getMonth() - 1);
        renderCalendar();
    });

    nextBtn.addEventListener('click', () => {
        calendarCurrentDate.setMonth(calendarCurrentDate.getMonth() + 1);
        renderCalendar();
    });

    // Form Submit
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const dateInput = document.getElementById('selectedDateInput').value;
        const timeInput = document.getElementById('selectedTimeInput').value;

        if (!dateInput || !timeInput) {
            alert("Por favor, selecione uma data e um horário disponíveis no painel de agendamento.");
            return;
        }

        // Gather Values
        const name = document.getElementById('clientName').value;
        const phone = document.getElementById('clientPhone').value;
        const email = document.getElementById('clientEmail').value;
        const issue = document.getElementById('deviceIssue').value;
        const service = document.getElementById('selectService').value;
        const delivery = document.getElementById('selectDelivery').value;

        // Generate unique OS Number
        const db = getOSDatabase();
        let isUnique = false;
        let generatedOS = "";
        while (!isUnique) {
            const randNum = Math.floor(1000 + Math.random() * 9000);
            generatedOS = `BIOS-${randNum}`;
            isUnique = !db.some(item => item.os === generatedOS);
        }

        // Format Date readable
        const dateParts = dateInput.split('-');
        const formattedDate = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;

        const serviceTextMap = {
            "computador": "Manutenção de Computadores & Notebooks",
            "gamer": "Upgrade & Universo PC Gamer",
            "celular": "Reparo de Celulares & Tablets",
            "site": "Criação de Sites Profissionais",
            "remoto": "Suporte Técnico Remoto (Nacional)"
        };

        const deliveryTextMap = {
            "leva-traz": "Sistema Leva e Traz (Coleta)",
            "entrega-loja": "Entrega Física na Loja",
            "remoto-acesso": "Acesso Remoto Seguro"
        };

        // Create new OS record
        const newRecord = {
            os: generatedOS,
            device: issue.split(',')[0] || "Equipamento",
            client: name,
            phone: phone,
            status: 1, // Recebido
            date: `${formattedDate} às ${timeInput}`,
            details: `Agendamento efetuado via site. Aguardando entrega ou suporte remoto marcado para ${formattedDate} às ${timeInput}.`
        };

        // Save OS
        saveOSToDatabase(newRecord);

        // Fill Confirmation screen Labels
        document.getElementById('lblGeneratedOS').textContent = generatedOS;
        document.getElementById('lblConfName').textContent = name;
        document.getElementById('lblConfService').textContent = serviceTextMap[service] || service;
        document.getElementById('lblConfMode').textContent = deliveryTextMap[delivery] || delivery;
        document.getElementById('lblConfDateTime').textContent = `${formattedDate} às ${timeInput}`;

        // Show overlay
        overlay.classList.remove('hidden');
    });

    // Close Confirmation overlay
    closeConfBtn.addEventListener('click', () => {
        overlay.classList.add('hidden');
        form.reset();
        resetSchedulingPicker();
    });

    // Transition to Tracking
    trackOSBtn.addEventListener('click', () => {
        const generatedOS = document.getElementById('lblGeneratedOS').textContent;
        overlay.classList.add('hidden');
        form.reset();
        resetSchedulingPicker();
        
        // Pre-fill and trigger tracker search
        const trackerInput = document.getElementById('osNumberInput');
        trackerInput.value = generatedOS;
        document.getElementById('btnTrackOS').click();
    });

    // First render
    renderCalendar();
}

function resetSchedulingPicker() {
    selectedDate = null;
    selectedTime = null;
    document.getElementById('selectedDateInput').value = '';
    document.getElementById('selectedTimeInput').value = '';
    renderCalendar();
    renderTimeSlots();
}

function renderCalendar() {
    const calendarDays = document.getElementById('calendarDaysContainer');
    const monthLbl = document.getElementById('lblCalendarMonth');
    
    calendarDays.innerHTML = '';

    const currentYear = calendarCurrentDate.getFullYear();
    const currentMonth = calendarCurrentDate.getMonth();

    // Set Month Label
    const monthNames = [
        "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
        "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
    ];
    monthLbl.textContent = `${monthNames[currentMonth]} ${currentYear}`;

    // Get First Day of month and Total Days in month
    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const totalDays = new Date(currentYear, currentMonth + 1, 0).getDate();
    
    const today = new Date();

    // Render Blank offset cells for weekdays alignment
    for (let i = 0; i < firstDay; i++) {
        const blank = document.createElement('div');
        blank.className = "calendar-day-btn disabled";
        calendarDays.appendChild(blank);
    }

    // Render Days
    for (let day = 1; day <= totalDays; day++) {
        const dayBtn = document.createElement('button');
        dayBtn.type = "button";
        dayBtn.className = "calendar-day-btn";
        dayBtn.textContent = day;

        const dateObj = new Date(currentYear, currentMonth, day);
        const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

        // Disable conditions: past days or Sundays (0)
        const isPast = dateObj < new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const isSunday = dateObj.getDay() === 0;

        if (isPast || isSunday) {
            dayBtn.classList.add('disabled');
            dayBtn.disabled = true;
        } else {
            // Check if Today
            if (dateObj.toDateString() === today.toDateString()) {
                dayBtn.classList.add('today');
            }

            // Check if Selected
            if (selectedDate === dateStr) {
                dayBtn.classList.add('selected');
            }

            // Click Handler
            dayBtn.addEventListener('click', () => {
                // Clear selected elements
                document.querySelectorAll('.calendar-day-btn.selected').forEach(el => {
                    el.classList.remove('selected');
                });
                
                dayBtn.classList.add('selected');
                selectedDate = dateStr;
                selectedTime = null; // reset time selection on date change
                
                document.getElementById('selectedDateInput').value = dateStr;
                document.getElementById('selectedTimeInput').value = '';
                
                // Format readable Date message
                const daysOfWeek = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
                document.getElementById('lblSelectedDateText').textContent = `${daysOfWeek[dateObj.getDay()]}, ${day} de ${monthNames[currentMonth]}`;
                
                renderTimeSlots();
            });
        }

        calendarDays.appendChild(dayBtn);
    }
}

function renderTimeSlots() {
    const container = document.getElementById('timeSlotsContainer');
    container.innerHTML = '';

    if (!selectedDate) {
        container.innerHTML = '<div class="no-slots-msg">Selecione uma data para carregar horários livres.</div>';
        return;
    }

    const availableSlots = ["09:00", "10:00", "11:00", "14:00", "15:00", "16:00", "17:00"];
    const db = getOSDatabase();

    // Filter appointments on selected date to check if already booked
    const bookedTimes = db
        .filter(item => {
            const appointmentDateStr = item.date.split(' às ')[0]; // DD/MM/YYYY
            const selectedDateFormatted = selectedDate.split('-').reverse().join('/'); // DD/MM/YYYY
            return appointmentDateStr === selectedDateFormatted;
        })
        .map(item => item.date.split(' às ')[1]); // HH:MM

    availableSlots.forEach(time => {
        const slotBtn = document.createElement('button');
        slotBtn.type = "button";
        slotBtn.className = "time-slot-btn";
        slotBtn.textContent = time;

        const isBooked = bookedTimes.includes(time);

        if (isBooked) {
            slotBtn.classList.add('disabled');
            slotBtn.disabled = true;
            slotBtn.style.opacity = '0.35';
            slotBtn.style.cursor = 'not-allowed';
        } else {
            if (selectedTime === time) {
                slotBtn.classList.add('selected');
            }

            slotBtn.addEventListener('click', () => {
                document.querySelectorAll('.time-slot-btn.selected').forEach(el => {
                    el.classList.remove('selected');
                });
                
                slotBtn.classList.add('selected');
                selectedTime = time;
                document.getElementById('selectedTimeInput').value = time;
            });
        }

        container.appendChild(slotBtn);
    });

    if (container.children.length === 0) {
        container.innerHTML = '<div class="no-slots-msg">Sem horários disponíveis para o dia selecionado.</div>';
    }
}

/* ==========================================================================
   5. Conversational Bot Widget Flow
   ========================================================================== */
function initChatbot() {
    const toggleBtn = document.getElementById('chatToggleBtn');
    const chatWindow = document.getElementById('chatWindow');
    const badge = document.getElementById('chatBadge');
    
    const messagesContainer = document.getElementById('chatMessages');
    const inputForm = document.getElementById('chatInputForm');
    const msgInput = document.getElementById('chatMessageInput');
    
    let isTransferredToLucas = false;

    // Toggle Chat Window open/closed
    toggleBtn.addEventListener('click', () => {
        chatWindow.classList.toggle('hidden');
        
        const openIcon = toggleBtn.querySelector('.chat-icon-open');
        const closeIcon = toggleBtn.querySelector('.chat-icon-close');
        
        openIcon.classList.toggle('hidden');
        closeIcon.classList.toggle('hidden');

        // Clear notification badge
        badge.classList.add('hidden');
        
        // Scroll to bottom
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    });

    // Chat Quick Option Clicks
    messagesContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-chat-opt')) {
            const optionNum = e.target.getAttribute('data-opt');
            const optionText = e.target.textContent;

            // Remove options block after selection
            const parentBlock = e.target.closest('.chat-quick-options');
            if (parentBlock) {
                parentBlock.innerHTML = `<p style="font-size:0.75rem; color:var(--color-text-dim); margin-top:6px; font-style:italic;">Opção selecionada: ${optionText}</p>`;
            }

            // Append User message
            appendChatMessage(optionText, 'user');
            
            // Trigger Bot Response
            handleBotOption(optionNum);
        }
    });

    // User Text input Submit
    inputForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = msgInput.value.trim();
        if (!text) return;

        appendChatMessage(text, 'user');
        msgInput.value = '';

        // Bot responds
        showTypingIndicator();
        
        setTimeout(() => {
            removeTypingIndicator();
            
            let reply = "";
            if (isTransferredToLucas) {
                reply = "Entendi. Esse sintoma pode estar relacionado a diversas causas físicas ou de software. O ideal seria realizarmos um agendamento online aqui no site ou trazer o equipamento diretamente à nossa unidade para uma análise completa e orçamento sem compromisso. Deseja agendar?";
            } else {
                reply = "Interessante! Estou te transferindo para o Técnico Lucas para te dar um suporte personalizado. Aguarde um instante...";
                isTransferredToLucas = true;
                
                // Simulate transition after transfer
                setTimeout(() => {
                    showTypingIndicator();
                    setTimeout(() => {
                        removeTypingIndicator();
                        appendChatMessage("Olá! Lucas aqui. Vi sua dúvida sobre o aparelho. Poderia me informar o modelo exato dele e há quanto tempo apresenta esse problema?", 'bot');
                    }, 1500);
                }, 2000);
            }

            appendChatMessage(reply, 'bot');
        }, 1200);
    });
}

function appendChatMessage(text, sender) {
    const container = document.getElementById('chatMessages');
    const msgDiv = document.createElement('div');
    msgDiv.className = `msg msg-${sender}`;
    msgDiv.innerHTML = `<div class="msg-content">${text}</div>`;
    
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
}

function showTypingIndicator() {
    const container = document.getElementById('chatMessages');
    const typingDiv = document.createElement('div');
    typingDiv.className = "msg msg-bot" ;
    typingDiv.id = "chatTypingIndicator";
    typingDiv.innerHTML = `
        <div class="msg-content typing-bubble">
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
        </div>
    `;
    container.appendChild(typingDiv);
    container.scrollTop = container.scrollHeight;
}

function removeTypingIndicator() {
    const indicator = document.getElementById('chatTypingIndicator');
    if (indicator) {
        indicator.remove();
    }
}

function handleBotOption(option) {
    showTypingIndicator();

    setTimeout(() => {
        removeTypingIndicator();
        let botResponse = "";

        switch (option) {
            case "1": // Remote Support
                botResponse = `
                    O Suporte Remoto resolve problemas de lentidão, infecção de malwares/vírus, configurações de e-mails, impressoras e programas que não abrem.<br><br>
                    <strong>Passo a passo:</strong><br>
                    1. Você agenda o horário aqui no site.<br>
                    2. Baixa o RustDesk ou AnyDesk.<br>
                    3. Conectamos com total segurança sob sua supervisão.<br><br>
                    <a href="#agendamento" class="btn btn-accent btn-chat-link" style="width:100%; margin-top:8px; font-size:0.8rem; padding:8px 12px;" onclick="document.getElementById('chatToggleBtn').click();">Ir Para Agendamento</a>
                `;
                break;
            case "2": // Hardware repair
                botResponse = `
                    Realizamos reparos avançados em notebooks e computadores de todas as marcas (Dell, Acer, Asus, Lenovo, HP, Samsung, Apple).<br><br>
                    Oferecemos <strong>Leva e Traz</strong> em Santos e Guarujá ou você pode entregar em nossa loja. Orçamento sem compromisso!<br><br>
                    Selecione "Manutenção de Computadores" no nosso formulário abaixo para reservar sua vaga.<br><br>
                    <a href="#agendamento" class="btn btn-primary btn-chat-link" style="width:100%; margin-top:8px; font-size:0.8rem; padding:8px 12px;" onclick="document.getElementById('chatToggleBtn').click();">Reservar Horário</a>
                `;
                break;
            case "3": // Gamer PC
                botResponse = `
                    PC travando ou com FPS baixo? Nós resolvemos! Fazemos montagem do zero sob medida, upgrades estratégicos de placa de vídeo/processador, limpeza pesada com troca de pasta térmica e otimização total do Windows para games.<br><br>
                    Deseja planejar sua máquina ou fazer um upgrade? Agende um atendimento ou envie uma mensagem com o setup que planeja montar!
                `;
                break;
            case "4": // Web Sites
                botResponse = `
                    Criamos sites institucionais, Landing Pages profissionais de alta conversão e lojas virtuais.<br><br>
                    Além do site, configuramos seu <strong>SEO Local em Santos e Guarujá</strong> e seu Perfil da Empresa no Google Maps para atrair clientes locais diariamente.<br><br>
                    Por favor, digite seu nome e telefone/e-mail para que nosso desenvolvedor envie propostas personalizadas.
                `;
                break;
            case "5": // Human Support
                botResponse = "Estou transferindo você para o canal humano de plantão. Lucas já irá te responder. Por favor, descreva em poucas palavras o que está acontecendo com seu aparelho.";
                // Set transfer state true
                setTimeout(() => {
                    showTypingIndicator();
                    setTimeout(() => {
                        removeTypingIndicator();
                        appendChatMessage("Olá! Lucas aqui. Como posso ajudar com o seu aparelho hoje?", 'bot');
                    }, 1200);
                }, 2000);
                break;
            default:
                botResponse = "Entendi! Por favor, aguarde um instante enquanto direciono seu atendimento.";
        }

        appendChatMessage(botResponse, 'bot');
    }, 1200);
}

/* ==========================================================================
   6. Custom Actions & Navigation CTA Links
   ========================================================================== */
function initServiceCTAs() {
    // When click on any Service Card button "Agendar"
    document.querySelectorAll('.btn-service-select').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const serviceType = btn.getAttribute('data-service');
            
            if (serviceType) {
                const serviceSelect = document.getElementById('selectService');
                const deliverySelect = document.getElementById('selectDelivery');
                
                // Pre-select matching Dropdown options
                serviceSelect.value = serviceType;
                
                // Pre-select delivery modal if remote was requested
                if (serviceType === 'remoto') {
                    deliverySelect.value = 'remoto-acesso';
                } else {
                    deliverySelect.value = 'leva-traz'; // Default to pickup
                }
                
                // Trigger change event if needed
                serviceSelect.dispatchEvent(new Event('change'));
                deliverySelect.dispatchEvent(new Event('change'));
            }
        });
    });
}
