import "./ProjectHeader.css";

type Props = {
  project?: {
    id: string;
    code?: string;
    name?: string;
    customer?: string;
    status?: string;
    // Which tag under the enquiry is being edited. Shown alongside the
    // enquiry no. so users always see BOTH pieces of context - reports and
    // wizard state are per-tag now, so knowing the enquiry alone isn't enough.
    tagId?: string;
    tagName?: string;
  };
};

// Minimal - the project id + the open tag's name. Renders nothing when there's
// no project in context (e.g. starting a selection outside a project).
const ProjectHeader = ({ project }: Props) => {
  if (!project?.id) return null;

  return (
    <p className="project-id-line">
      Enquiry no.: <span>{project.code ?? project.id}</span>
      {project.tagName ? (
        <>
          {" "}
          &nbsp;·&nbsp; Tag: <span>{project.tagName}</span>
        </>
      ) : null}
    </p>
  );
};

export default ProjectHeader;
