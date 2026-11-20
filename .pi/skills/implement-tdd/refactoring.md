# Refactor Candidates

After the TDD cycle, look for these in the code this slice added or changed. Leave everything else alone: report what you notice elsewhere as an observation.

- **Duplication** → Extract function/class
- **Long methods** → Break into private helpers (keep tests on public interface)
- **Shallow modules** → Combine or deepen
- **Feature envy** → Move logic to where data lives
- **Primitive obsession** → Introduce value objects
