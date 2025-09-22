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
  status: 'active' | 'archived' | 'deleted';
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

  const { name, status } = req.body;
  if (!name) return res.status(422).json({ error: 'Name is required' });

  project.name = name;
  if (status) project.status = status;
  project.updated_at = new Date().toISOString();
  saveProjects();
  res.json(project);
});

app.delete('/api/projects/:projectId', authMiddleware, (req, res) => {
  projects = projects.filter(p => p.id !== req.params.projectId);
  saveProjects();
  res.status(200).json({ success: true });
});

// --- Designs Endpoints ---

app.get('/api/projects/:projectId/designs', authMiddleware, (req, res) => {
  const project = projects.find(p => p.id === req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project.designs);
});

app.post('/api/projects/:projectId/design', authMiddleware, (req, res) => {
  const project = projects.find(p => p.id === req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { name } = req.body;
  const now = new Date().toISOString();
  const newDesign: Design = {
    id: uuidv4(),
    project_id: project.id,
    name: name || `Design ${project.designs.length + 1}`,
    status: 'running',
    progress: 0,
    created_at: now,
    started_at: now
  };
  project.designs.push(newDesign);
  project.current_design_id = newDesign.id;
  project.updated_at = now;
  saveProjects();
  res.status(201).json(newDesign);
});

// --- SSE Endpoint ---

app.get('/api/designs/:designId/sse', authMiddleware, (req, res) => {
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
      clearInterval(interval);
      res.end();
    } else {
      sendEvent('status', { progress, job_status: 'running', message: 'Design running...' });

      // Example extra events
      if (progress === 30) sendEvent('stlfile', { url: `/files/design_${req.params.designId}.stl` });
      if (progress === 60) sendEvent('glbfile', { url: `/files/design_${req.params.designId}.glb` });
      if (progress === 90) sendEvent('csvfile', { name: `results_${req.params.designId}.csv` });
    }
  }, 1000);
});

// --- Legacy endpoints ---

app.post('/api/start', authMiddleware, (_req, res) => {
  res.json({ status: 'queued', id: `legacy_${Date.now()}` });
});

app.get('/api/status', authMiddleware, (_req, res) => {
  res.json({ status: 'running', progress: 50 });
});

app.get('/api/sse', authMiddleware, (_req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let progress = 0;
  const interval = setInterval(() => {
    progress += 20;
    if (progress >= 100) {
      res.write(`data: ${JSON.stringify({ status: 'completed', progress: 100 })}\n\n`);
      clearInterval(interval);
      res.end();
    } else {
      res.write(`data: ${JSON.stringify({ status: 'running', progress })}\n\n`);
    }
  }, 1500);
});

app.listen(PORT, () => {
  console.log(`🚀 Fake UAV Optimizer API running on http://localhost:${PORT}`);
});
