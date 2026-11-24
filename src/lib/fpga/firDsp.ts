/**
 * A worked DSP datapath for the Verilog subset: 4-tap FIR filter.
 *
 * The coefficients are [1, 2, 2, 1], so the multiply is a shift the synthesis
 * flow never has to invent — `2 * x` is written as `x + x`, which is the same
 * adder tree a constant-coefficient DSP compiler builds. A 12-bit output holds
 * the largest possible sum (255 * 6 = 1530) without overflow, so the run is
 * exact rather than saturated.
 *
 *   y[n] = x[n] + 2·x[n-1] + 2·x[n-2] + x[n-3]
 *
 * The three delay registers form the classic transposed-free FIR line; reset is
 * synchronous and clears the pipeline so the first samples are not mixed with
 * unknown history.
 */
export const FIR_DSP_VERILOG = `// 4-tap FIR low-pass (coefficients 1, 2, 2, 1) with a 12-bit accumulator
module fir4(
  input clk,
  input rst,
  input [7:0] sample,
  output [11:0] y
);
  reg [7:0] d1;
  reg [7:0] d2;
  reg [7:0] d3;

  always @(posedge clk) begin
    if (rst) begin
      d1 <= 8'd0;
      d2 <= 8'd0;
      d3 <= 8'd0;
    end else begin
      d1 <= sample;
      d2 <= d1;
      d3 <= d2;
    end
  end

  assign y = sample + d1 + d1 + d2 + d2 + d3;
endmodule
`;
