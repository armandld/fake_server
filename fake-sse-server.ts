import express, { Request, Response } from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const PORT = 4000;

app.use(cors());
app.use(express.json());

// --- Fake token ---
const VALID_TOKEN = 'fake-cloudflare-token';

// --- Auth middleware ---
function authMiddleware(req: Request, res: Response, next: () => void) {
  // always allow for local dev
  return next();
}

// --- Data storage ---
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');

interface Design {
  id: string;
  project_id: string;
  name: string;
  status: 'created' | 'submitted' | 'pending' | 'runnable' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress: number;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  results?: any;
  error_details?: string;
}

interface Project {
  id: string;
  name: string;
  user_email?: string;
  description?: string;
  mission_requirements?: Record<string, any>;
  status: 'active' | 'running' | 'succeeded'|'failed';
  created_at: string;
  updated_at: string;
  current_design_id?: string;
  designs: Design[];
}

let projects: Project[] = fs.existsSync(PROJECTS_FILE)
  ? JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'))
  : [];

function saveProjects() {
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

// --- Projects Endpoints ---

app.get('/api/projects', authMiddleware, (_req, res) => {
  res.json(projects);
});

app.post('/api/projects', authMiddleware, (req, res) => {
  const { name, description, mission_requirements } = req.body;
  if (!name) return res.status(422).json({ error: 'Name is required' });

  const now = new Date().toISOString();
  const newProject: Project = {
    id: uuidv4(),
    name,
    description,
    mission_requirements,
    status: 'active',
    created_at: now,
    updated_at: now,
    designs: []
  };
  projects.push(newProject);
  saveProjects();
  res.status(201).json(newProject);
});

app.get('/api/projects/:projectId', authMiddleware, (req, res) => {
  const project = projects.find(p => p.id === req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
});

app.put('/api/projects/:projectId', authMiddleware, (req, res) => {
  const project = projects.find(p => p.id === req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { name, status, description, mission_requirements } = req.body;

  if (name!== undefined) project.name = name;
  if (status!== undefined) project.status = status;
  if (description !== undefined) project.description = description;
  if (mission_requirements !== undefined) project.mission_requirements = mission_requirements;

  project.updated_at = new Date().toISOString();
  saveProjects();
  res.json(project);
});


app.delete('/api/projects/:projectId', authMiddleware, (req, res) => {
  projects = projects.filter(p => p.id !== req.params.projectId);
  saveProjects();
  res.status(200).json({ success: true });
});


// --- SSE Endpoint --


app.get('/api/projects/:projectId/sse', authMiddleware, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let progress = 0;
  const interval = setInterval(() => {
    progress += 10;
    if (progress >= 100) {
      sendEvent('status', { progress: 100, job_status: 'succeeded', message: 'Design completed' });
      sendEvent('complete', { message: 'Design finished successfully' });
      sendEvent( 'animated_airframe', {
          url: `http://localhost:${PORT}/files/uav_design_3_animated.glb`,
          stream_sim: false
        });
        sendEvent( 'glbfile', {
          url: `http://localhost:${PORT}/files/battery.glb`,
          n_glbfiles: 2
        });
        sendEvent( 'glbfile', {
          url: `http://localhost:${PORT}/files/rc_engine.glb`,
          n_glbfiles: 2
        });
        sendEvent( 'csvfile', {
          url: `http://localhost:${PORT}/files/bom.csv`,
          name: 'bom.csv'
        });
        clearInterval(interval);
    } else {
      sendEvent('status', { progress, job_status: 'running', message: 'Design running...' });
    }
  }, 1000);
});

app.get('/api/projects/:projectId/loadsse', authMiddleware, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');


  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  setTimeout(() => {
    sendEvent( 'animated_airframe', {
            url: `http://localhost:${PORT}/files/uav_design_3_animated.glb`,
            stream_sim: false
          });
          sendEvent( 'glbfile', {
            url: `http://localhost:${PORT}/files/battery.glb`,
            n_glbfiles: 2
          });
          sendEvent( 'glbfile', {
            url: `http://localhost:${PORT}/files/rc_engine.glb`,
            n_glbfiles: 2
          });
          sendEvent( 'csvfile', {
            url: `http://localhost:${PORT}/files/bom.csv`,
            name: 'bom.csv'
          });
  }, 100);      
});

// --- Legacy endpoints ---

app.post('/api/start', authMiddleware, (_req, res) => {
  res.json({ status: 'queued', id: `legacy_${Date.now()}` });
});

app.get('/api/status', authMiddleware, (_req, res) => {
  res.json({ status: 'running', progress: 50 });
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
/*
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
*/
app.listen(PORT, () => {
  console.log(`🚀 Fake UAV Optimizer API running on http://localhost:${PORT}`);
});
