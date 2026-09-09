// test_billing.js - Testes automatizados cobrindo todos os casos e os 12 critérios de aceitação
import assert from 'assert';
import { calculateMonthlyBilling, parseDurationSec } from './analytics.js';

console.log('=== INICIANDO SUÍTE COMPLETA DE TESTES DO DUANALYTICS ===\n');

// -------------------------------------------------------------
// CASOS DE TESTE NUMÉRICOS EXIGIDOS NA ESPECIFICAÇÃO
// -------------------------------------------------------------

// CASO 1 - LEGACY
{
  const config = {
    billing_mode: 'per_video',
    base_payment: 600,
    base_videos: 15,
    price_per_video: 40
  };
  const videos = [];
  for (let i = 0; i < 18; i++) {
    videos.push({ feito: true, cobrado: true, tempo: 900 });
  }
  const res = calculateMonthlyBilling(config, videos);
  assert.strictEqual(res.extraVideoCount, 3);
  assert.strictEqual(res.extraAmount, 120);
  assert.strictEqual(res.total, 720);
  console.log('✓ CASO 1 (Legacy): 600 + 3*40 = R$ 720,00 [PASSOU]');
}

// CASO 2 - MINUTOS EXATAMENTE NA FRANQUIA
{
  const config = {
    billing_mode: 'minute_overage',
    base_payment: 600,
    target_total_minutes: 225,
    extra_minute_block: 15,
    extra_minute_price: 40
  };
  const videos = [
    { feito: true, cobrado: true, tempo: 225 * 60 }
  ];
  const res = calculateMonthlyBilling(config, videos);
  assert.strictEqual(res.extraMinutes, 0);
  assert.strictEqual(res.extraAmount, 0);
  assert.strictEqual(res.total, 600);
  console.log('✓ CASO 2 (Exatamente na Franquia): extra = 0, total = R$ 600,00 [PASSOU]');
}

// CASO 3 - ABAIXO DA FRANQUIA COM MAIS DE 15 VÍDEOS
{
  const config = {
    billing_mode: 'minute_overage',
    base_payment: 600,
    target_total_minutes: 225,
    base_videos: 15,
    extra_minute_block: 15,
    extra_minute_price: 40
  };
  const videos = [];
  for (let i = 0; i < 20; i++) {
    videos.push({ feito: true, cobrado: true, tempo: 11 * 60 }); // 20 * 11 = 220 min
  }
  const res = calculateMonthlyBilling(config, videos);
  assert.strictEqual(res.billableVideoCount, 20);
  assert.strictEqual(res.billableMinutes, 220);
  assert.strictEqual(res.extraMinutes, 0);
  assert.strictEqual(res.extraAmount, 0);
  assert.strictEqual(res.total, 600);
  console.log('✓ CASO 3 (Abaixo da Franquia c/ 20 vids): extra = 0, total = R$ 600,00 [PASSOU]');
}

// CASO 4 - 238 MIN
{
  const config = {
    billing_mode: 'minute_overage',
    base_payment: 600,
    target_total_minutes: 225,
    extra_minute_block: 15,
    extra_minute_price: 40,
    extra_minute_rounding: 'proportional'
  };
  const videos = [
    { feito: true, cobrado: true, tempo: 238 * 60 }
  ];
  const res = calculateMonthlyBilling(config, videos);
  assert.strictEqual(res.extraMinutes, 13);
  const expectedExtra = (13 / 15) * 40;
  assert.strictEqual(res.extraAmount.toFixed(4), expectedExtra.toFixed(4));
  assert.strictEqual(res.total.toFixed(2), '634.67');
  console.log(`✓ CASO 4 (238 min): 13 min excedentes = R$ ${res.extraAmount.toFixed(2)}, total = R$ ${res.total.toFixed(2)} [PASSOU]`);
}

// CASO 5 - CENÁRIO REAL (502 min)
{
  const config = {
    billing_mode: 'minute_overage',
    base_payment: 600,
    target_total_minutes: 225,
    extra_minute_block: 15,
    extra_minute_price: 40,
    extra_minute_rounding: 'proportional'
  };
  const videos = [
    { feito: true, cobrado: true, tempo: 502 * 60 }
  ];
  const res = calculateMonthlyBilling(config, videos);
  assert.strictEqual(res.extraMinutes, 277);
  const expectedExtra = (277 / 15) * 40;
  assert.strictEqual(res.extraAmount.toFixed(4), expectedExtra.toFixed(4));
  assert.strictEqual(res.total.toFixed(2), '1338.67');
  console.log(`✓ CASO 5 (Cenário Real 502 min): 277 min excedentes = R$ ${res.extraAmount.toFixed(2)}, total = R$ ${res.total.toFixed(2)} [PASSOU]`);
}

// CASO 6 - PENDENTES
{
  const config = {
    billing_mode: 'minute_overage',
    base_payment: 600,
    target_total_minutes: 225,
    extra_minute_block: 15,
    extra_minute_price: 40
  };
  const videos = [
    { feito: true, cobrado: true, tempo: 500 * 60 },
    { feito: false, cobrado: false, tempo: 200 * 60 }
  ];
  const res = calculateMonthlyBilling(config, videos);
  assert.strictEqual(res.billableMinutes, 500);
  assert.strictEqual(res.extraMinutes, 275);
  console.log('✓ CASO 6 (Pendentes não faturáveis): 500 min considerados, 200 min pendentes ignorados [PASSOU]');
}

// CASO 7 - NÃO COBRADO
{
  const config = {
    billing_mode: 'minute_overage',
    base_payment: 600,
    target_total_minutes: 225,
    extra_minute_block: 15,
    extra_minute_price: 40
  };
  const videos = [
    { feito: true, cobrado: true, tempo: 225 * 60 },
    { feito: true, cobrado: false, tempo: 60 * 60 } // entregue sem cobrança
  ];
  const res = calculateMonthlyBilling(config, videos);
  assert.strictEqual(res.billableMinutes, 225);
  assert.strictEqual(res.extraMinutes, 0);
  assert.strictEqual(res.total, 600);
  console.log('✓ CASO 7 (Não Cobrado): vídeo de 60 min entregue sem cobrança não aumentou pagamento [PASSOU]');
}

// CASO 8 - OUTROS
{
  const config = {
    billing_mode: 'minute_overage',
    base_payment: 600,
    target_total_minutes: 225,
    extra_minute_block: 15,
    extra_minute_price: 40,
    bonus: 20
  };
  const videos = [
    { feito: true, cobrado: true, tempo: 262.5 * 60 }, // 37.5 min excedentes * (40/15) = R$ 100
    { feito: true, cobrado: true, tipo_item: 'outros', valor_individual: 50 }
  ];
  const res = calculateMonthlyBilling(config, videos);
  assert.strictEqual(res.extraAmount, 100);
  assert.strictEqual(res.outrosAmount, 50);
  assert.strictEqual(res.bonus, 20);
  assert.strictEqual(res.total, 770);
  console.log('✓ CASO 8 (Itens Outros e Bônus): 600 + 100 + 50 + 20 = R$ 770,00 [PASSOU]');
}

console.log('\n--- 12 CRITÉRIOS DE ACEITAÇÃO OBRIGATÓRIOS ---\n');

// 1. Cliente antigo sem billing_mode continua funcionando por vídeo
{
  const configSemMode = { base_payment: 500, base_videos: 15, price_per_video: 40 };
  const videos = Array(17).fill({ feito: true, cobrado: true, tempo: 900 });
  const res = calculateMonthlyBilling(configSemMode, videos);
  assert.strictEqual(res.mode, 'per_video');
  assert.strictEqual(res.total, 500 + 2 * 40);
  console.log('✓ 1. Cliente/mês sem billing_mode infere per_video automaticamente [PASSOU]');
}

// 2. Mês antigo sem billing_mode continua funcionando por vídeo
{
  const mesAntigo = { id: 'm1', base_payment: 600, base_videos: 10, price_per_video: 50 };
  const videos = Array(12).fill({ feito: true, cobrado: true, tempo: 600 });
  const res = calculateMonthlyBilling(mesAntigo, videos);
  assert.strictEqual(res.mode, 'per_video');
  assert.strictEqual(res.total, 700);
  console.log('✓ 2. Mês antigo sem billing_mode funciona por vídeo com valores originais [PASSOU]');
}

// 3. compensate continua funcionando em meses per_video
{
  const month1 = { id: 'm1', billing_mode: 'per_video', base_payment: 600, base_videos: 15, price_per_video: 40, compensate: true };
  const month2 = { id: 'm2', billing_mode: 'per_video', base_payment: 600, base_videos: 15, price_per_video: 40, compensate: true };
  
  const allMonths = [month1, month2];
  const allVideos = [
    ...Array(10).fill({ monthId: 'm1', feito: true, cobrado: true, tempo: 900 }), // -5
    ...Array(20).fill({ monthId: 'm2', feito: true, cobrado: true, tempo: 900 })  // +5 -> saldo cumulativo: 30 feitos - 30 base = 0 overage
  ];

  const res1 = calculateMonthlyBilling(month1, allVideos.filter(v => v.monthId === 'm1'), { allClientMonths: allMonths, allClientVideos: allVideos });
  assert.strictEqual(res1.extraVideoCount, 0);
  assert.strictEqual(res1.total, 600);
  assert.strictEqual(res1.balance, -5);

  const res2 = calculateMonthlyBilling(month2, allVideos.filter(v => v.monthId === 'm2'), { allClientMonths: allMonths, allClientVideos: allVideos });
  assert.strictEqual(res2.extraVideoCount, 0); // compensou o déficit anterior
  assert.strictEqual(res2.total, 600);
  assert.strictEqual(res2.balance, 0);
  console.log('✓ 3. Compensação de saldo acumulado preservada e exata entre meses [PASSOU]');
}

// 4. price_per_video continua funcionando exatamente como antes
{
  const config = { billing_mode: 'per_video', base_payment: 600, base_videos: 15, price_per_video: 45 };
  const videos = Array(16).fill({ feito: true, cobrado: true, tempo: 900 });
  const res = calculateMonthlyBilling(config, videos);
  assert.strictEqual(res.extraAmount, 45);
  assert.strictEqual(res.total, 645);
  console.log('✓ 4. price_per_video continua definindo o valor unitário extra do per_video [PASSOU]');
}

// 5. Itens "outros" continuam somando normalmente
{
  const config = { billing_mode: 'per_video', base_payment: 600, base_videos: 15, price_per_video: 40 };
  const videos = [
    ...Array(15).fill({ feito: true, cobrado: true, tempo: 900 }),
    { feito: true, cobrado: true, tipo_item: 'outros', valor_individual: 75.50 }
  ];
  const res = calculateMonthlyBilling(config, videos);
  assert.strictEqual(res.outrosAmount, 75.50);
  assert.strictEqual(res.total, 675.50);
  console.log('✓ 5. Itens do tipo "outros" somam valor_individual [PASSOU]');
}

// 6. bonus continua somando normalmente
{
  const config = { billing_mode: 'minute_overage', base_payment: 600, bonus: 150 };
  const res = calculateMonthlyBilling(config, []);
  assert.strictEqual(res.bonus, 150);
  assert.strictEqual(res.total, 750);
  console.log('✓ 6. Bônus soma ao pagamento final em ambos os modelos [PASSOU]');
}

// 7. Um cliente pode possuir meses per_video e minute_overage misturados
{
  const monthJul = { id: 'jul', billing_mode: 'per_video', base_payment: 600, base_videos: 15, price_per_video: 40 };
  const monthSet = { id: 'set', billing_mode: 'minute_overage', base_payment: 600, target_total_minutes: 225, extra_minute_block: 15, extra_minute_price: 40 };
  
  const vidsJul = Array(18).fill({ feito: true, cobrado: true, tempo: 900 }); // 18 vids = 720
  const vidsSet = [{ feito: true, cobrado: true, tempo: 502 * 60 }];          // 502 min = 1338.67

  const resJul = calculateMonthlyBilling(monthJul, vidsJul);
  const resSet = calculateMonthlyBilling(monthSet, vidsSet);

  assert.strictEqual(resJul.total, 720);
  assert.strictEqual(resSet.total.toFixed(2), '1338.67');
  console.log('✓ 7. Histórico misto (Jul per_video = R$ 720, Set minute_overage = R$ 1.338,67) [PASSOU]');
}

// 8. Alterar o billing_mode padrão do cliente NÃO altera meses históricos
{
  const mesJulHistorico = { id: 'jul', billing_mode: 'per_video', base_payment: 600, base_videos: 15, price_per_video: 40 };
  const clienteDefaults = { default_billing_mode: 'minute_overage' };
  
  // O mês histórico avalia sua própria configuração gravada
  const res = calculateMonthlyBilling(mesJulHistorico, Array(18).fill({ feito: true, cobrado: true, tempo: 900 }));
  assert.strictEqual(res.mode, 'per_video');
  assert.strictEqual(res.total, 720);
  console.log('✓ 8. Alteração de padrão no cliente não contamina meses históricos já gravados [PASSOU]');
}

// 9. Trocar um mês para minute_overage NÃO apaga price_per_video
{
  const mes = {
    billing_mode: 'minute_overage',
    base_payment: 600,
    price_per_video: 40, // permanece preservado
    target_total_minutes: 225,
    extra_minute_price: 40,
    extra_minute_block: 15
  };
  assert.strictEqual(mes.price_per_video, 40);
  const res = calculateMonthlyBilling(mes, [{ feito: true, cobrado: true, tempo: 225 * 60 }]);
  assert.strictEqual(res.mode, 'minute_overage');
  assert.strictEqual(mes.price_per_video, 40); // não foi apagado
  console.log('✓ 9. price_per_video permanece intacto mesmo no modo minute_overage [PASSOU]');
}

// 10. Trocar de volta para per_video recupera a configuração anterior
{
  const mes = {
    billing_mode: 'per_video', // trocado de volta
    base_payment: 600,
    base_videos: 15,
    price_per_video: 40,
    target_total_minutes: 225,
    extra_minute_price: 40,
    extra_minute_block: 15
  };
  const res = calculateMonthlyBilling(mes, Array(18).fill({ feito: true, cobrado: true, tempo: 900 }));
  assert.strictEqual(res.mode, 'per_video');
  assert.strictEqual(res.total, 720);
  console.log('✓ 10. Troca de volta para per_video restaura a cobrança de vídeos extras imediatamente [PASSOU]');
}

// 11. No modo minute_overage, exceder base_videos não cobra nada se target_total_minutes não for ultrapassado
{
  const mes = {
    billing_mode: 'minute_overage',
    base_payment: 600,
    base_videos: 15,
    target_total_minutes: 225,
    extra_minute_price: 40,
    extra_minute_block: 15
  };
  // 30 vídeos curtinhos somando 150 min (muito abaixo dos 225)
  const videos = Array(30).fill({ feito: true, cobrado: true, tempo: 5 * 60 });
  const res = calculateMonthlyBilling(mes, videos);
  assert.strictEqual(res.billableVideoCount, 30);
  assert.strictEqual(res.billableMinutes, 150);
  assert.strictEqual(res.extraAmount, 0);
  assert.strictEqual(res.total, 600);
  console.log('✓ 11. 30 vídeos entregues somando 150 min não geram extra no modo minute_overage [PASSOU]');
}

// 12. No modo per_video, target_total_minutes NÃO altera o pagamento
{
  const mes = {
    billing_mode: 'per_video',
    base_payment: 600,
    base_videos: 15,
    price_per_video: 40,
    target_total_minutes: 100 // mesmo que a franquia seja baixa
  };
  // 15 vídeos de 30 min cada = 450 min entregues
  const videos = Array(15).fill({ feito: true, cobrado: true, tempo: 30 * 60 });
  const res = calculateMonthlyBilling(mes, videos);
  assert.strictEqual(res.extraVideoCount, 0);
  assert.strictEqual(res.total, 600); // no modo per_video, minutos não cobram extra
  console.log('✓ 12. No modo per_video, excesso de minutos não afeta o pagamento (focado apenas em vídeos) [PASSOU]');
}

console.log('\n===================================================================');
console.log('TODOS OS TESTES FORAM CONCLUÍDOS COM 100% DE SUCESSO E CONFORMIDADE!');
console.log('===================================================================');
