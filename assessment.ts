import fetch from 'node-fetch';

const API_KEY = 'ak_281675d0b2b2d0d2307b08b1d4807eda343e2c232e2a8e6e'
const BASE_URL = 'https://assessment.ksensetech.com/api';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
  
interface Patient {
  patient_id: string;
  name?: string;
  age?: number | null;
  gender?: string;
  blood_pressure?: string;
  temperature?: number | string | null;
  visit_date?: string;
  diagnosis?: string[];
}

async function fetchWithRetry(
    url: string,
    options: RequestInit = {},
    retries = 7,
    delayMs = 1000
  ): Promise<any> {
    if (!options.headers) options.headers = {};
    (options.headers as Record<string, string>)['x-api-key'] = API_KEY;
  
    if ('body' in options && options.body === null) delete options.body;
  
    for (let attempt = 0; attempt <= retries; attempt++) {
      const response = await fetch(url, options as import('node-fetch').RequestInit);
      if (response.ok) return response.json();
  
      if (response.status === 429 || response.status >= 500) {
        const baseWait = delayMs * Math.pow(2, attempt); 
        const jitter = Math.floor(Math.random() * delayMs); 
        const wait = baseWait + jitter;
  
        console.warn(`⚠️ Received ${response.status}. Retrying in ${wait}ms (attempt ${attempt + 1}/${retries + 1})...`);
        await delay(wait);
        continue;
      }
  
      throw new Error(`HTTP ${response.status}`);
    }
  
    throw new Error(`Failed after ${retries + 1} retries.`);
  }
  
  
  async function fetchAllPatients(): Promise<Patient[]> {
    let allPatients: Patient[] = [];
    let page = 1;
  
    while (true) {
      const url = `${BASE_URL}/patients?page=${page}&limit=5`;
      const data = await fetchWithRetry(url);
      if (!data) {
        break;
      }  
  
      const dataArray = data && Object.values(data).find(value => Array.isArray(value));

      if (!dataArray) {
        console.error(`❌ API response at page ${page}:`, JSON.stringify(data, null, 2));
        throw new Error(`Unexpected API response at page ${page}: missing array payload`);
      }
      allPatients = allPatients.concat(dataArray);
      if (data.pagination && data.pagination?.hasNext === false || dataArray.length === 0) {
        break;
      }
      page++;
      await delay(1500);
    }
  
    return allPatients;
  }
  

function parseBloodPressure(bp?: string): { systolic: number; diastolic: number } | null {
  if (!bp || !bp.includes('/')) return null;
  const [s, d] = bp.split('/').map((x) => parseInt(x.trim()));
  if (isNaN(s) || isNaN(d)) return null;
  return { systolic: s, diastolic: d };
}

function analyzePatients(patients: Patient[]) {
  const highRiskPatients: string[] = [];
  const feverPatients: string[] = [];
  const dataQualityIssues: string[] = [];

  for (const patient of patients) {
    const id = patient.patient_id;
    let riskScore = 0;
    let hasDataIssue = false;
    const age = patient.age;
    if (typeof age !== 'number') {
      hasDataIssue = true;
    } else if (age > 65) {
      riskScore += 2;
    } else if (age >= 45) {
        riskScore += 1;
    }
    let temp: number | null = null;
    if (typeof patient.temperature === 'string') {
      temp = parseFloat(patient.temperature);
      if (isNaN(temp)) hasDataIssue = true;
    } else if (typeof patient.temperature === 'number') {
      temp = patient.temperature;
    } else {
      hasDataIssue = true;
    }

    if (typeof temp === 'number') {
      if (temp >= 101) {
        riskScore += 2;
        feverPatients.push(id);
        } else if (temp >= 99.6) {
        riskScore += 1;
        feverPatients.push(id);
        }
    }

    const bp = parseBloodPressure(patient.blood_pressure);
    if (!bp) {
      hasDataIssue = true;
    } else if (bp.systolic >= 140 || bp.diastolic >= 90) {
      riskScore += 3;
    } else if (bp.systolic >= 130 || bp.diastolic >= 80) {
        riskScore += 2;
    } else if (bp.systolic >= 120 && bp.diastolic < 80) {
        riskScore += 1;
    }
    if (riskScore >= 4) {
      highRiskPatients.push(id);
    }

    if (hasDataIssue) {
      dataQualityIssues.push(id);
    }
  }

  return {
    high_risk_patients: highRiskPatients,
    fever_patients: feverPatients,
    data_quality_issues: dataQualityIssues,
  };
}

async function submitResults(results: any) {
  const res = await fetch(`${BASE_URL}/submit-assessment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify(results),
  });

  if (!res.ok) {
    throw new Error(`Submit failed: ${res.status} - ${await res.text()}`);
  }

  const responseData = await res.json();
  console.log('Submission successful:', responseData);
}

(async () => {
  try {
    const patients = await fetchAllPatients();
    const results = analyzePatients(patients);
    await submitResults(results); 
  } catch (err) {
    console.error('❌ Error:', err);
  }
})();
