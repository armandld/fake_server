import express, { Request, Response } from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = 4000;

app.use(cors());
app.use(express.json());

let clients: Response[] = [];

function sendEvent(client: Response, event: string, data: any) {
  client.write(`event: ${event}\n`);
  client.write(`data: ${JSON.stringify(data)}\n\n`);
}

// --- SSE endpoint ---
app.get('/api/sse', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  clients.push(res);

  req.on('close', () => {
    clients = clients.filter(c => c !== res);
  });
});

// --- Endpoint pour servir les fichiers ---
app.get('/files/:filename', (req: Request, res: Response) => {
  const { filename } = req.params;
  const filePath = path.join(__dirname, 'fake_files', filename); // dossier local fake_files

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Fichier non trouvé');
  }

  const ext = path.extname(filename).toLowerCase();
  if (ext === '.stl') res.setHeader('Content-Type', 'application/sla');
  else if (ext === '.json') res.setHeader('Content-Type', 'application/json');
  else if (ext === '.csv') res.setHeader('Content-Type', 'text/csv');

  fs.createReadStream(filePath).pipe(res);
});

let progress = 0;

function startSimulation() {
  const interval = setInterval(() => {
    progress += 5;
    //if (progress > 100) progress = 0; // restart after 100

    // Envoie du progrès
    clients.forEach(client =>
      sendEvent(client, 'status', {
        progress,
        message: `Progression à ${progress}%`
      })
    );

    // 50% → envoyer STL + JSON

    // 100% → envoyer STL + CSV + complete
    if (progress === 100) {
      clients.forEach(client => {
        sendEvent(client, 'stlfile', {
          url: `http://localhost:${PORT}/files/geometry.stl`,
          stream_sim: false
        });
        sendEvent(client, 'glbfile', {
          url: `http://localhost:${PORT}/files/battery.glb`,
          n_glbfiles: 2
        });
        sendEvent(client, 'glbfile', {
          url: `http://localhost:${PORT}/files/rc_engine.glb`,
          n_glbfiles: 2
        });
        sendEvent(client, 'csvfile', {
          url: `http://localhost:${PORT}/files/bom.csv`,
          name: 'bom.csv'
        });
        
      });
    }
  }, 1000);
}

// --- POST pour lancer ---
app.post('/api/start', (req: Request, res: Response) => {
  res.json({ status: 'Simulation démarrée' });
  if (progress === 0) startSimulation();
});

app.listen(PORT, () => {
  console.log(`🚀 Fake SSE Server running on http://localhost:${PORT}`);
});
