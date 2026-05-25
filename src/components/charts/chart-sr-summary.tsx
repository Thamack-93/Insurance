type ChartSrSummaryProps = {
  title: string;
  data: { name: string; value: number }[];
};

export function ChartSrSummary({ title, data }: ChartSrSummaryProps) {
  if (data.length === 0) return null;
  return (
    <table className="sr-only">
      <caption>{title}</caption>
      <thead>
        <tr>
          <th scope="col">Etiqueta</th>
          <th scope="col">Valor</th>
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr key={row.name}>
            <td>{row.name}</td>
            <td>{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
