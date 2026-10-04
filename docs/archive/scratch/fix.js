        if (subtitleEl) {
          if (data?.masked_email) {
            subtitleEl.textContent =
              `Tiklash kodi tayyorlandi. Foydalanuvchida zaxira email bor (${esc(data.masked_email)}). ` +
              `Siz uni to'g'ridan-to'g'ri uning pochtasiga yuborishingiz yoki kodni o'ziga berishingiz mumkin:`;
          } else {
            subtitleEl.textContent =
              "Foydalanuvchida zaxira email yo'q. " +
              "Quyidagi bir martalik tiklash kodini (OTP) foydalanuvchiga taqdim eting:";
          }
        }

        const sendEmailBtn = $('adminResetSendEmailBtn');
        if (sendEmailBtn) {
          if (data?.masked_email) {
            sendEmailBtn.style.display = 'block';
            sendEmailBtn.onclick = async () => {
              const oldTxt = sendEmailBtn.textContent;
              sendEmailBtn.disabled = true;
              sendEmailBtn.textContent = 'Yuborilmoqda...';
              try {
                const { error: fnErr } = await sb.functions.invoke('send-recovery-email', {
                  body: { username: data.username, temp_password: _code }
                });
                if (fnErr) throw fnErr;
                toast('Xat yuborildi!', 'success');
                sendEmailBtn.style.display = 'none';
              } catch (e) {
                toast('Xatolik: ' + e.message, 'error');
                sendEmailBtn.disabled = false;
                sendEmailBtn.textContent = oldTxt;
              }
            };
          } else {
            sendEmailBtn.style.display = 'none';
          }
        }
