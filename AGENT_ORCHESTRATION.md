# AI Agent Architecture & Orchestration

This document outlines the multi-agent system utilized within the application. Our architecture employs specialized agents that handle discrete tasks, communicating through our FastAPI backend to ensure efficient processing and task delegation.

## Agent Roster

| Agent Name | Primary Role | Core Capabilities | Technologies Used |
| :--- | :--- | :--- | :--- |
| **OrchestratorAgent** | Task routing and workflow management | Evaluates user input, breaks down complex workflows, and routes tasks to specialized agents. | Python, LangChain/LlamaIndex |
| **VisionProcessorAgent** | Media analysis and manipulation | Handles image understanding, coordinates with background removal models (e.g., U^2-Net), and tags visual metadata. | Gemini 3.5 Flash (Vision), OpenCV |
| **DataSynthesizerAgent** | Information extraction and formatting | Parses raw data, extracts key entities, and formats JSON outputs for the Next.js frontend to render. | Gemini 3.5 Flash, Pydantic |

## Agent Communication Protocol

Agents operate in a stateless, decoupled manner. They communicate via asynchronous task queues (e.g., Redis + Celery or FastAPI Background Tasks).

1.  **Task Initiation:** The Next.js frontend sends a request payload to the `/api/agents/dispatch` endpoint.
2.  **Routing:** The `OrchestratorAgent` intercepts the payload, determines the required sequence of operations, and pushes sub-tasks to the queue.
3.  **Execution:** Worker nodes running the specialized agents pick up the tasks. 
4.  **State Management:** Agents update the task status in PostgreSQL. The frontend polls or listens via WebSockets for completion events.

## Creating a New Agent

To implement a new agent in the Python backend, extend the base `Agent` class:

```python
from app.agents.base import BaseAgent
from app.services.llm import GeminiService

class CustomAgent(BaseAgent):
    def __init__(self):
        super().__init__(name="CustomAgent")
        self.llm = GeminiService(model="gemini-3.5-flash")

    async def execute(self, payload: dict) -> dict:
        prompt = self._build_prompt(payload)
        response = await self.llm.generate(prompt)
        return self._parse_response(response)
```
