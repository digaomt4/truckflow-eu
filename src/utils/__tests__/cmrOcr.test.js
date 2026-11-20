import { describe, expect, it } from 'vitest';
import { CMR_STATUS_OPTIONS, parseCmrOcrText } from '../cmrOcr';
import { buildCmrFileName, buildCmrShareSummary } from '../cmrScanner';

describe('cmrOcr & metadata helpers', () => {
  it('exposes the 4 required CMR status stages in Portuguese', () => {
    expect(CMR_STATUS_OPTIONS.map((s) => s.label)).toEqual([
      'Recebido',
      'Assinado',
      'Escaneado',
      'Enviado',
    ]);
  });

  it('extracts CMR number, load number, sender, recipient, trailer plate, seal and signed status', () => {
    const parsed = parseCmrOcrText({
      topRightText: 'CARTA DE PORTE INTERNACIONAL\nCMR\nN.º 45614',
      box1Text:
        '1 Remitente (nombre, domicilio, país)\nTK Elevator Manufacturing Spain, S.L.\nMóstoles, Madrid',
      box2Text:
        '2 Consignatario (nombre, domicilio, país)\nTK Elevators Aufzugswerke GmbH\nEsslingen am Neckar',
      fullText:
        'CMR N.º 45614\nORDER: 849201\nREBOQUE: L-1234-BBB · SELO: SEAL-88412\nENTREGUE CONFORME',
      signatureScore: 0.025,
    });

    expect(parsed.cmrNumber).toBe('45614');
    expect(parsed.loadNumber).toBe('849201');
    expect(parsed.sender).toBe('TK Elevator Manufacturing Spain, S.L.');
    expect(parsed.recipient).toBe('TK Elevators Aufzugswerke GmbH');
    expect(parsed.trailerPlate).toBe('L-1234-BBB');
    expect(parsed.sealNumber).toBe('SEAL-88412');
    expect(parsed.suggestedStatus).toBe('signed');
    expect(parsed.detectedCount).toBe(6);
  });

  it('falls back to fullText scanning and suggests scanned status without signature', () => {
    const parsed = parseCmrOcrText({
      fullText: [
        'CMR Nº: 77812',
        'CARGA Nº: 90215',
        '1. REMETENTE (EXPEDIDOR)',
        'LOGÍSTICA IBÉRICA S.A.',
        '2. DESTINATÁRIO (CONSIGNATÁRIO)',
        'EURODISTRIBUTION GMBH',
        'REMOLQUE: R-4423-BBC',
        'PRECINTO: PR-9910',
      ].join('\n'),
      signatureScore: 0.004,
    });

    expect(parsed.cmrNumber).toBe('77812');
    expect(parsed.loadNumber).toBe('90215');
    expect(parsed.sender).toBe('LOGÍSTICA IBÉRICA S.A.');
    expect(parsed.recipient).toBe('EURODISTRIBUTION GMBH');
    expect(parsed.trailerPlate).toBe('R-4423-BBC');
    expect(parsed.sealNumber).toBe('PR-9910');
    expect(parsed.suggestedStatus).toBe('scanned');
  });

  it('builds CMR filenames with CMR number + load number without duplication', () => {
    expect(buildCmrFileName('2026-11-20', '84920', '45614')).toBe(
      'CMR_2026-11-20_45614_84920.pdf'
    );
    expect(buildCmrFileName('2026-11-20', '84920', '84920')).toBe(
      'CMR_2026-11-20_84920.pdf'
    );
    expect(buildCmrFileName('2026-11-20', '', '45614')).toBe(
      'CMR_2026-11-20_45614.pdf'
    );
    expect(buildCmrFileName('2026-11-20', ' 84920 / A ')).toBe(
      'CMR_2026-11-20_84920-A.pdf'
    );
  });

  it('builds structured WhatsApp share summary with CMR metadata', () => {
    const text = buildCmrShareSummary({
      cmrNumber: '45614',
      loadNumber: '84920',
      date: '2026-11-20',
      sender: 'Empresa A',
      recipient: 'Empresa B',
      trailerPlate: 'L-1234-BBB',
      sealNumber: 'SEAL-88412',
    });

    expect(text).toContain('CMR Nº 45614');
    expect(text).toContain('Carga 84920');
    expect(text).toContain('Remetente: Empresa A');
    expect(text).toContain('Destinatário: Empresa B');
    expect(text).toContain('Reboque: L-1234-BBB');
    expect(text).toContain('Selo: SEAL-88412');
  });
});
